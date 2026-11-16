import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { importSpecifiers } from "../bay/import-scanner.ts";
import { fieldOf, isRecord, textField, textsField, toJson } from "../bay/json.ts";

type Feature = {
  readonly name: string;
  readonly entry: readonly string[];
  readonly private: readonly string[];
  readonly mayImport: readonly string[];
};

type OutsideFolder = {
  readonly folder: string;
  readonly importsKernelThrough: readonly string[];
};

type FeatureMap = {
  readonly features: readonly Feature[];
  readonly outside: readonly OutsideFolder[];
};

type SourceFile = {
  readonly file: string;
  readonly imports: readonly string[];
};

type Rule =
  | "may-not-import"
  | "private-file"
  | "outside-reaches-in"
  | "kernel-reaches-out"
  | "test-reaches-in"
  | "inside-reaches-across";

type Break = {
  readonly from: string;
  readonly to: string;
  readonly rule: Rule;
};

type Debt = {
  readonly unlisted: readonly Break[];
  readonly stale: readonly Break[];
};

const rules: readonly Rule[] = [
  "may-not-import",
  "private-file",
  "outside-reaches-in",
  "kernel-reaches-out",
  "test-reaches-in",
  "inside-reaches-across",
];

const scannedFolders = ["bay", "adapters", "components", "schemas"] as const;

const testFolder = "tests";

const debtKeys = { kit: "breaks", tests: "test_breaks" } as const;

const featuresTestedAtTheirEntry: readonly string[] = ["runs"];

const mapFile = "framework/features.yaml";

const debtFile = "framework/feature-map-debt.yaml";

const writeDebtVariable = "FEATURE_MAP_DEBT";

function entriesOf(value: Json | undefined): readonly (readonly [string, Json])[] {
  return value !== undefined && isRecord(value) ? Object.entries(value).map(([key, item]) => [key, toJson(item)]) : [];
}

function parsedMap(text: string): FeatureMap {
  const map = toJson(parse(text));
  const features = entriesOf(fieldOf(map, "features")).map(([name, feature]) => ({
    name,
    entry: textsField(feature, "entry"),
    private: textsField(feature, "private"),
    mayImport: textsField(feature, "may_import"),
  }));
  const outside = entriesOf(fieldOf(map, "outside")).map(([folder, entry]) => ({
    folder,
    importsKernelThrough: textsField(entry, "imports_kernel_through"),
  }));
  return { features, outside };
}

function scanned(file: string, source: string): SourceFile {
  const imports = importSpecifiers(source).flatMap((specifier) =>
    specifier.kind === "literal" && specifier.text.startsWith(".")
      ? [normalize(join(dirname(file), specifier.text))]
      : [],
  );
  return { file, imports: [...new Set(imports)] };
}

function isKernelFile(file: string): boolean {
  return file.startsWith("bay/");
}

function isInside(file: string, folder: string): boolean {
  return file.startsWith(`${folder}/`);
}

function featuresOf(map: FeatureMap, file: string): readonly Feature[] {
  return map.features.filter((feature) => feature.entry.includes(file) || feature.private.includes(file));
}

function coverageProblems(map: FeatureMap, kernelFiles: readonly string[]): readonly string[] {
  return kernelFiles.flatMap((file) => {
    const names = featuresOf(map, file).map((feature) => feature.name);
    if (names.length === 1) {
      return [];
    }
    return [
      names.length === 0
        ? `${file} is in no feature`
        : `${file} is in ${String(names.length)} features: ${names.join(", ")}`,
    ];
  });
}

function kernelImportRule(map: FeatureMap, from: string, to: string): Rule | undefined {
  if (!isKernelFile(to)) {
    return isInside(to, "adapters") || isInside(to, "components") ? "kernel-reaches-out" : undefined;
  }
  const [own] = featuresOf(map, from);
  const [target] = featuresOf(map, to);
  if (own === undefined || target === undefined || own.name === target.name) {
    return undefined;
  }
  if (!own.mayImport.includes(target.name)) {
    return "may-not-import";
  }
  return target.private.includes(to) ? "private-file" : undefined;
}

function outsideImportRule(map: FeatureMap, from: string, to: string): Rule | undefined {
  const folder = map.outside.find((outside) => isInside(from, outside.folder));
  const allowed = folder?.importsKernelThrough ?? [];
  return isKernelFile(to) && !allowed.includes(to) ? "outside-reaches-in" : undefined;
}

function insideFeatureOf(file: string): string | undefined {
  const [first, second, feature, ...rest] = file.split("/");
  return first === testFolder && second === "inside" && rest.length > 0 ? feature : undefined;
}

function testImportRule(map: FeatureMap, from: string, to: string): Rule | undefined {
  const [target] = featuresOf(map, to);
  if (target === undefined || !target.private.includes(to)) {
    return undefined;
  }
  const inside = insideFeatureOf(from);
  if (inside === undefined) {
    return "test-reaches-in";
  }
  return inside === target.name ? undefined : "inside-reaches-across";
}

function ruleOf(map: FeatureMap, from: string, to: string): Rule | undefined {
  if (isInside(from, testFolder)) {
    return testImportRule(map, from, to);
  }
  return isKernelFile(from) ? kernelImportRule(map, from, to) : outsideImportRule(map, from, to);
}

function mapBreaks(map: FeatureMap, sources: readonly SourceFile[]): readonly Break[] {
  return sources.flatMap((source) =>
    source.imports.flatMap((to) => {
      const rule = ruleOf(map, source.file, to);
      return rule === undefined ? [] : [{ from: source.file, to, rule }];
    }),
  );
}

function keyOf(found: Break): string {
  return `${found.from} -> ${found.to} (${found.rule})`;
}

function debtOf(breaks: readonly Break[], listed: readonly Break[]): Debt {
  const listedKeys = new Set(listed.map(keyOf));
  const breakKeys = new Set(breaks.map(keyOf));
  return {
    unlisted: breaks.filter((found) => !listedKeys.has(keyOf(found))),
    stale: listed.filter((entry) => !breakKeys.has(keyOf(entry))),
  };
}

function breakOf(entry: Json): Break | undefined {
  const rule = rules.find((known) => known === textField(entry, "rule"));
  const from = textField(entry, "from");
  const to = textField(entry, "to");
  return rule === undefined || from === undefined || to === undefined ? undefined : { from, to, rule };
}

function parsedDebt(text: string, key: string): readonly Break[] {
  const entries = fieldOf(toJson(parse(text)), key);
  return Array.isArray(entries) ? entries.flatMap((entry: unknown) => breakOf(toJson(entry)) ?? []) : [];
}

function sortedBreaks(breaks: readonly Break[]): readonly Break[] {
  return [...breaks].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

function writesDebt(environment: Readonly<Record<string, string | undefined>>): boolean {
  return environment[writeDebtVariable] === "write";
}

function typeScriptFiles(folders: readonly string[]): readonly string[] {
  return folders.flatMap((folder) =>
    readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts"))
      .map((file) => join(folder, file)),
  );
}

function kitFiles(): readonly string[] {
  return typeScriptFiles(scannedFolders);
}

function breaksIn(map: FeatureMap, files: readonly string[]): readonly Break[] {
  return sortedBreaks(
    mapBreaks(
      map,
      files.map((file) => scanned(file, readFileSync(file, "utf8"))),
    ),
  );
}

const smallMap = parsedMap(`
features:
  words:
    entry: [bay/words.ts]
    private: [bay/spelling.ts]
    may_import: []
  runs:
    entry: [bay/engine.ts]
    private: [bay/walk.ts]
    may_import: [words]
outside:
  adapters/harness:
    imports_kernel_through: [bay/engine.ts]
`);

const relative = (to: string): string => `import { x } from "${to}";`;

test("the small map is read with its features, entry files, private files and outside folders", () => {
  assert.deepEqual(
    smallMap.features.map((feature) => [feature.name, feature.entry, feature.private, feature.mayImport]),
    [
      ["words", ["bay/words.ts"], ["bay/spelling.ts"], []],
      ["runs", ["bay/engine.ts"], ["bay/walk.ts"], ["words"]],
    ],
  );
  assert.deepEqual(smallMap.outside, [{ folder: "adapters/harness", importsKernelThrough: ["bay/engine.ts"] }]);
});

test("a kernel file in exactly one feature passes, and one in no feature or in two fails", () => {
  assert.deepEqual(coverageProblems(smallMap, ["bay/words.ts", "bay/walk.ts"]), []);
  assert.deepEqual(coverageProblems(smallMap, ["bay/stray.ts"]), ["bay/stray.ts is in no feature"]);
  assert.deepEqual(
    coverageProblems(parsedMap(stringify({ features: { a: { entry: ["bay/a.ts"] }, b: { private: ["bay/a.ts"] } } })), [
      "bay/a.ts",
    ]),
    ["bay/a.ts is in 2 features: a, b"],
  );
});

test("a file may import its own feature's files and the entry files of features it may import", () => {
  const sources = [
    scanned("bay/engine.ts", relative("./walk.ts")),
    scanned("bay/walk.ts", `${relative("./words.ts")}\nimport { y } from "node:path";\nimport { z } from "yaml";`),
  ];
  assert.deepEqual(mapBreaks(smallMap, sources), []);
});

test("a file that imports from a feature its own feature may not import breaks may-not-import", () => {
  const sources = [scanned("bay/spelling.ts", relative("./walk.ts")), scanned("bay/words.ts", relative("./engine.ts"))];
  assert.deepEqual(mapBreaks(smallMap, sources), [
    { from: "bay/spelling.ts", to: "bay/walk.ts", rule: "may-not-import" },
    { from: "bay/words.ts", to: "bay/engine.ts", rule: "may-not-import" },
  ]);
});

test("a file that imports another feature's private file breaks private-file", () => {
  const sources = [scanned("bay/walk.ts", `const s = await import("./spelling.ts");`)];
  assert.deepEqual(mapBreaks(smallMap, sources), [
    { from: "bay/walk.ts", to: "bay/spelling.ts", rule: "private-file" },
  ]);
});

test("outside the kernel only the files named in imports_kernel_through may be imported", () => {
  const sources = [
    scanned("adapters/harness/adapter.ts", `${relative("../../bay/engine.ts")}\n${relative("./steps.ts")}`),
    scanned("adapters/harness/tests/build.test.ts", relative("../../../bay/walk.ts")),
    scanned("components/modes/notes/scripts/add.ts", relative("../../../../bay/engine.ts")),
  ];
  assert.deepEqual(mapBreaks(smallMap, sources), [
    { from: "adapters/harness/tests/build.test.ts", to: "bay/walk.ts", rule: "outside-reaches-in" },
    { from: "components/modes/notes/scripts/add.ts", to: "bay/engine.ts", rule: "outside-reaches-in" },
  ]);
});

test("a file of the type generator in schemas/ may import only the kernel files listed for schemas", () => {
  const map = parsedMap(`
features:
  words:
    entry: [bay/words.ts]
    private: [bay/spelling.ts]
    may_import: []
outside:
  schemas:
    imports_kernel_through: [bay/words.ts]
`);
  const generator = scanned(
    "schemas/generate-types.ts",
    `${relative("../bay/words.ts")}\n${relative("../bay/spelling.ts")}`,
  );
  const unlisted = scanned("schemas/other.ts", relative("../bay/words.ts"));
  assert.deepEqual(mapBreaks(map, [generator]), [
    { from: "schemas/generate-types.ts", to: "bay/spelling.ts", rule: "outside-reaches-in" },
  ]);
  assert.deepEqual(mapBreaks(smallMap, [unlisted]), [
    { from: "schemas/other.ts", to: "bay/words.ts", rule: "outside-reaches-in" },
  ]);
});

test("a kernel file that imports from adapters/ or components/ breaks kernel-reaches-out", () => {
  const sources = [
    scanned("bay/engine.ts", `export { a } from "../adapters/harness/adapter.ts";`),
    scanned("bay/generated/mode.ts", relative("../../components/base/store/scripts/put.ts")),
  ];
  assert.deepEqual(mapBreaks(smallMap, sources), [
    { from: "bay/engine.ts", to: "adapters/harness/adapter.ts", rule: "kernel-reaches-out" },
    { from: "bay/generated/mode.ts", to: "components/base/store/scripts/put.ts", rule: "kernel-reaches-out" },
  ]);
});

test("a test outside tests/inside/<feature>/ may import a feature's entry file, and its private file breaks test-reaches-in", () => {
  const sources = [
    scanned("tests/engine.test.ts", `${relative("../bay/engine.ts")}\n${relative("../bay/words.ts")}`),
    scanned("tests/walk.test.ts", relative("../bay/walk.ts")),
    scanned("tests/spelling-fixture.ts", relative("../bay/spelling.ts")),
    scanned("tests/inside/walk.test.ts", relative("../../bay/walk.ts")),
  ];
  assert.deepEqual(mapBreaks(smallMap, sources), [
    { from: "tests/walk.test.ts", to: "bay/walk.ts", rule: "test-reaches-in" },
    { from: "tests/spelling-fixture.ts", to: "bay/spelling.ts", rule: "test-reaches-in" },
    { from: "tests/inside/walk.test.ts", to: "bay/walk.ts", rule: "test-reaches-in" },
  ]);
});

test("a file in tests/inside/<feature>/ may import its own feature's private files, and another's breaks inside-reaches-across", () => {
  const sources = [
    scanned("tests/inside/runs/crash.test.ts", relative("../../../bay/walk.ts")),
    scanned(
      "tests/inside/runs/crash-fixture.ts",
      `${relative("../../../bay/words.ts")}\n${relative("../../fakes.ts")}`,
    ),
    scanned("tests/inside/runs/spelling.test.ts", relative("../../../bay/spelling.ts")),
    scanned("tests/inside/words/walk.test.ts", relative("../../../bay/walk.ts")),
    scanned("tests/inside/words/spelling.test.ts", relative("../../../bay/spelling.ts")),
  ];
  assert.deepEqual(mapBreaks(smallMap, sources), [
    { from: "tests/inside/runs/spelling.test.ts", to: "bay/spelling.ts", rule: "inside-reaches-across" },
    { from: "tests/inside/words/walk.test.ts", to: "bay/walk.ts", rule: "inside-reaches-across" },
  ]);
});

test("a break listed in the debt passes, an unlisted break fails, and a listed entry with no break is stale", () => {
  const listed: Break = { from: "bay/words.ts", to: "bay/engine.ts", rule: "may-not-import" };
  const unlisted: Break = { from: "bay/walk.ts", to: "bay/spelling.ts", rule: "private-file" };
  const stale: Break = { ...listed, rule: "private-file" };
  assert.deepEqual(debtOf([listed], [listed]), { unlisted: [], stale: [] });
  assert.deepEqual(debtOf([listed, unlisted], [listed, stale]), { unlisted: [unlisted], stale: [stale] });
});

test("the debt file is read back as the breaks it lists, and entries with an unknown rule are dropped", () => {
  const text = stringify({
    breaks: [
      { from: "bay/a.ts", to: "bay/b.ts", rule: "private-file" },
      { from: "bay/a.ts", to: "bay/c.ts", rule: "ignored" },
    ],
  });
  assert.deepEqual(parsedDebt(text, "breaks"), [{ from: "bay/a.ts", to: "bay/b.ts", rule: "private-file" }]);
  assert.deepEqual(parsedDebt(text, "test_breaks"), []);
});

test("the debt file is written only when FEATURE_MAP_DEBT is write", () => {
  assert.equal(writesDebt({}), false);
  assert.equal(writesDebt({ FEATURE_MAP_DEBT: "yes" }), false);
  assert.equal(writesDebt({ FEATURE_MAP_DEBT: "write" }), true);
});

test("the scan of the kit reads files in the kernel and in every folder the map lists outside it", () => {
  const files = kitFiles();
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  for (const folder of ["bay", "bay/generated", ...map.outside.map((outside) => outside.folder)]) {
    assert.ok(
      files.some((file) => isInside(file, folder)),
      folder,
    );
  }
});

test("the scan of the kit reads the type generator, which the map lists under outside with the kernel files it imports", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  assert.ok(kitFiles().includes("schemas/generate-types.ts"));
  assert.deepEqual(map.outside.find((outside) => outside.folder === "schemas")?.importsKernelThrough, [
    "bay/node-ports.ts",
    "bay/ports.ts",
  ]);
});

test("every kernel file of the kit is in exactly one feature", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  assert.deepEqual(coverageProblems(map, kitFiles().filter(isKernelFile)), []);
});

test("the kit's imports and its tests' imports break the feature map only where the debt file says so", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  const found = { kit: breaksIn(map, kitFiles()), tests: breaksIn(map, typeScriptFiles([testFolder])) };
  if (writesDebt(process.env)) {
    writeFileSync(debtFile, stringify({ [debtKeys.kit]: found.kit, [debtKeys.tests]: found.tests }));
  }
  const text = readFileSync(debtFile, "utf8");
  for (const list of ["kit", "tests"] as const) {
    const debt = debtOf(found[list], parsedDebt(text, debtKeys[list]));
    const key = debtKeys[list];
    assert.deepEqual(debt.unlisted.map(keyOf), [], `These imports break framework/features.yaml (${key}).`);
    assert.deepEqual(debt.stale.map(keyOf), [], `These entries of ${key} in ${debtFile} match no import: delete them.`);
  }
});

test("no test reaches into a feature whose tests have moved to its entry file, and the debt lists none", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  const moved = map.features.filter((feature) => featuresTestedAtTheirEntry.includes(feature.name));
  assert.deepEqual(
    moved.map((feature) => feature.name),
    featuresTestedAtTheirEntry,
  );
  const reachesMoved = (found: Break): boolean => moved.some((feature) => feature.private.includes(found.to));
  const listed = parsedDebt(readFileSync(debtFile, "utf8"), debtKeys.tests);
  assert.deepEqual(
    breaksIn(map, typeScriptFiles([testFolder]))
      .filter(reachesMoved)
      .map(keyOf),
    [],
  );
  assert.deepEqual(listed.filter(reachesMoved).map(keyOf), []);
});
