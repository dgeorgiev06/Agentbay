import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path/posix";
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

type ModesRule = {
  readonly within: string;
  readonly importsKernelThrough: readonly string[];
  readonly testsImportKitThrough: readonly string[];
};

type InterfacesRule = {
  readonly within: string;
  readonly sharedTest: string;
  readonly sharedTestsImportKitThrough: readonly string[];
};

type ModeFolder = {
  readonly folder: string;
  readonly implements: readonly string[];
};

type FeatureMap = {
  readonly features: readonly Feature[];
  readonly outside: readonly OutsideFolder[];
  readonly modes: ModesRule | undefined;
  readonly interfaces: InterfacesRule | undefined;
  readonly modeFolders: readonly ModeFolder[];
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
  | "inside-reaches-across"
  | "mode-test-reaches-out"
  | "shared-test-reaches-out";

type Break = {
  readonly from: string;
  readonly to: string;
  readonly rule: Rule;
};

type SealedFolder = {
  readonly feature: string;
  readonly folder: string;
  readonly entry: string;
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
  "mode-test-reaches-out",
  "shared-test-reaches-out",
];

const scannedFolders = ["bay", "adapters", "components", "schemas"] as const;

const testFolder = "tests";

const debtKeys = { kit: "breaks", tests: "test_breaks" } as const;

const featuresTestedAtTheirEntry: readonly string[] = ["manifests", "runs"];

const featuresSealedInTheirFolder: readonly string[] = ["manifests", "runs"];

const mapFile = "framework/features.yaml";

const modeManifest = "mode.yaml";

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
  return {
    features,
    outside,
    modes: modesRuleOf(fieldOf(map, "modes")),
    interfaces: interfacesRuleOf(fieldOf(map, "interfaces")),
    modeFolders: [],
  };
}

function modesRuleOf(value: Json | undefined): ModesRule | undefined {
  const within = value === undefined ? undefined : textField(value, "within");
  if (value === undefined || within === undefined) {
    return undefined;
  }
  return {
    within,
    importsKernelThrough: textsField(value, "imports_kernel_through"),
    testsImportKitThrough: textsField(value, "tests_import_kit_through"),
  };
}

function interfacesRuleOf(value: Json | undefined): InterfacesRule | undefined {
  const within = value === undefined ? undefined : textField(value, "within");
  const sharedTest = value === undefined ? undefined : textField(value, "shared_test");
  if (value === undefined || within === undefined || sharedTest === undefined) {
    return undefined;
  }
  return { within, sharedTest, sharedTestsImportKitThrough: textsField(value, "shared_tests_import_kit_through") };
}

function modeFolderOf(manifestFile: string, manifest: string): ModeFolder {
  const references = textsField(toJson(parse(manifest)), "implements");
  return { folder: dirname(manifestFile), implements: references.map((reference) => reference.split("@")[0] ?? "") };
}

function modeFoldersIn(map: FeatureMap, files: readonly string[]): readonly string[] {
  const within = map.modes?.within;
  if (within === undefined) {
    return [];
  }
  return files.filter((file) => basename(file) === modeManifest && isInside(file, within)).map(dirname);
}

function withModeFolders(map: FeatureMap, folders: readonly ModeFolder[]): FeatureMap {
  const importsKernelThrough = map.modes?.importsKernelThrough ?? [];
  return {
    ...map,
    outside: [...map.outside, ...folders.map(({ folder }) => ({ folder, importsKernelThrough }))],
    modeFolders: [...map.modeFolders, ...folders],
  };
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

function modeOfTest(map: FeatureMap, file: string): ModeFolder | undefined {
  return map.modeFolders.find((mode) => isInside(file, join(mode.folder, testFolder)));
}

function sharedTestOf(rule: InterfacesRule, name: string): string {
  return join(rule.within, name, rule.sharedTest);
}

function isSharedTest(map: FeatureMap, file: string): boolean {
  const rule = map.interfaces;
  if (rule === undefined || !isInside(file, rule.within)) {
    return false;
  }
  const [name = ""] = file.slice(rule.within.length + 1).split("/");
  return file === sharedTestOf(rule, name);
}

function modeTestImportRule(map: FeatureMap, mode: ModeFolder, to: string): Rule | undefined {
  const rule = map.interfaces;
  const sharedTests = rule === undefined ? [] : mode.implements.map((name) => sharedTestOf(rule, name));
  const allowed = [
    ...(map.modes?.testsImportKitThrough ?? []),
    ...(map.modes?.importsKernelThrough ?? []),
    ...sharedTests,
  ];
  return allowed.includes(to) || isInside(to, mode.folder) ? undefined : "mode-test-reaches-out";
}

function sharedTestImportRule(map: FeatureMap, to: string): Rule | undefined {
  const allowed = map.interfaces?.sharedTestsImportKitThrough ?? [];
  return allowed.includes(to) ? undefined : "shared-test-reaches-out";
}

function ruleOf(map: FeatureMap, from: string, to: string): Rule | undefined {
  if (isSharedTest(map, from)) {
    return sharedTestImportRule(map, to);
  }
  const mode = modeOfTest(map, from);
  if (mode !== undefined) {
    return modeTestImportRule(map, mode, to);
  }
  if (isSharedTest(map, to)) {
    return "shared-test-reaches-out";
  }
  if (isInside(from, testFolder)) {
    return testImportRule(map, from, to);
  }
  return isKernelFile(from) ? kernelImportRule(map, from, to) : outsideImportRule(map, from, to);
}

function sealedFolderOf(feature: Feature): SealedFolder | undefined {
  const [folder, ...otherFolders] = new Set(feature.private.map(dirname));
  const [entry, ...otherEntries] = feature.entry.filter((file) => dirname(file) === folder);
  if (folder === undefined || entry === undefined || otherFolders.length > 0 || otherEntries.length > 0) {
    return undefined;
  }
  return { feature: feature.name, folder, entry };
}

function reachesIntoFolder(sealed: SealedFolder, sources: readonly SourceFile[]): readonly string[] {
  const inside = `${testFolder}/inside/${sealed.feature}`;
  return sources.flatMap((source) => {
    if (isInside(source.file, sealed.folder) || isInside(source.file, inside)) {
      return [];
    }
    return source.imports
      .filter((to) => isInside(to, sealed.folder) && to !== sealed.entry)
      .map((to) => `${source.file} -> ${to}`);
  });
}

function reExportsIn(text: string): readonly string[] {
  return text.match(/^export\b[^;]*?\bfrom\s*["']/gm) ?? [];
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

function kitMap(): FeatureMap {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  const within = map.modes?.within;
  const files =
    within === undefined
      ? []
      : readdirSync(within, { recursive: true, encoding: "utf8" }).map((file) => join(within, file));
  const manifests = modeFoldersIn(map, files).map((folder) => join(folder, modeManifest));
  return withModeFolders(
    map,
    manifests.map((file) => modeFolderOf(file, readFileSync(file, "utf8"))),
  );
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

const mapWithModes = parsedMap(`
features:
  words:
    entry: [bay/words.ts]
    private: [bay/spelling.ts]
    may_import: []
modes:
  within: components
  imports_kernel_through: [bay/words.ts]
  tests_import_kit_through: [tests/test-toolbox.ts]
`);

test("the modes rule is read with the folder it covers, the kernel files a mode may import and the kit files its tests may import", () => {
  assert.deepEqual(mapWithModes.modes, {
    within: "components",
    importsKernelThrough: ["bay/words.ts"],
    testsImportKitThrough: ["tests/test-toolbox.ts"],
  });
  assert.deepEqual(mapWithModes.outside, []);
  assert.equal(smallMap.modes, undefined);
});

test("a folder that holds a mode.yaml under the modes rule's folder is a mode folder, and no other is", () => {
  const manifests = [
    "components/modes/notes/mode.yaml",
    "components/base/keeper/mode.yaml",
    "components/base/interfaces/notes.yaml",
    "tests/fixtures/stray/mode.yaml",
  ];
  assert.deepEqual(modeFoldersIn(mapWithModes, manifests), ["components/modes/notes", "components/base/keeper"]);
  assert.deepEqual(modeFoldersIn(smallMap, manifests), []);
});

test("a file of a mode folder may import only the kernel files the modes rule names, with no entry for the mode", () => {
  const map = withModeFolders(mapWithModes, [
    { folder: "components/modes/notes", implements: [] },
    { folder: "components/base/keeper", implements: [] },
  ]);
  const sources = [
    scanned("components/modes/notes/scripts/add.ts", relative("../../../../bay/words.ts")),
    scanned("components/modes/notes/scripts/lib/rows.ts", relative("../../../../../bay/spelling.ts")),
    scanned("components/base/keeper/tests/keep.test.ts", relative("../../../../bay/words.ts")),
    scanned("components/base/keeper/scripts/keep.ts", relative("../../../../tests/test-toolbox.ts")),
    scanned("components/base/interfaces/notes.ts", relative("../../../bay/words.ts")),
  ];
  assert.deepEqual(mapBreaks(map, sources), [
    { from: "components/modes/notes/scripts/lib/rows.ts", to: "bay/spelling.ts", rule: "outside-reaches-in" },
    { from: "components/base/interfaces/notes.ts", to: "bay/words.ts", rule: "outside-reaches-in" },
  ]);
});

test("a file under a mode's tests/ folder may import the test toolbox, the toolbox and its own mode's files, and nothing else", () => {
  const map = withModeFolders(mapWithModes, [
    { folder: "components/modes/notes", implements: [] },
    { folder: "components/base/keeper", implements: [] },
  ]);
  const test = "components/modes/notes/tests/add.test.ts";
  const sources = [
    scanned(test, relative("../../../../tests/test-toolbox.ts")),
    scanned(test, relative("../../../../bay/words.ts")),
    scanned(test, relative("../scripts/lib/rows.ts")),
    scanned("components/modes/notes/tests/rows.ts", relative("./add.test.ts")),
    scanned("components/modes/notes/tests/helper.ts", relative("../../../../tests/project-fixture.ts")),
    scanned("components/modes/notes/tests/kernel.test.ts", relative("../../../../bay/engine.ts")),
    scanned("components/modes/notes/tests/keeper.test.ts", relative("../../../base/keeper/scripts/keep.ts")),
  ];
  assert.deepEqual(mapBreaks(map, sources), [
    {
      from: "components/modes/notes/tests/helper.ts",
      to: "tests/project-fixture.ts",
      rule: "mode-test-reaches-out",
    },
    { from: "components/modes/notes/tests/kernel.test.ts", to: "bay/engine.ts", rule: "mode-test-reaches-out" },
    {
      from: "components/modes/notes/tests/keeper.test.ts",
      to: "components/base/keeper/scripts/keep.ts",
      rule: "mode-test-reaches-out",
    },
  ]);
});

const mapWithInterfaces = parsedMap(`
features:
  words:
    entry: [bay/words.ts]
    private: []
    may_import: []
modes:
  within: components
  imports_kernel_through: [bay/words.ts]
  tests_import_kit_through: [tests/test-toolbox.ts]
interfaces:
  within: components/base/interfaces
  shared_test: tests/shared.ts
  shared_tests_import_kit_through: [tests/test-toolbox.ts]
`);

const storeShared = "components/base/interfaces/items-store/tests/shared.ts";

test("the interfaces rule is read with its folder, the shared test's place in an interface's folder and what a shared test may import", () => {
  assert.deepEqual(mapWithInterfaces.interfaces, {
    within: "components/base/interfaces",
    sharedTest: "tests/shared.ts",
    sharedTestsImportKitThrough: ["tests/test-toolbox.ts"],
  });
  assert.equal(mapWithModes.interfaces, undefined);
});

test("a mode folder knows the interfaces its mode.yaml implements, by name", () => {
  assert.deepEqual(
    modeFolderOf("components/base/keeper/mode.yaml", "name: keeper\nimplements: [items-store@1, notes@2]\n"),
    {
      folder: "components/base/keeper",
      implements: ["items-store", "notes"],
    },
  );
  assert.deepEqual(modeFolderOf("components/modes/notes/mode.yaml", "name: notes\n"), {
    folder: "components/modes/notes",
    implements: [],
  });
});

test("a mode's test may import the shared test of an interface its mode implements, and no other interface's", () => {
  const map = withModeFolders(mapWithInterfaces, [
    { folder: "components/base/keeper", implements: ["items-store"] },
    { folder: "components/modes/notes", implements: ["notes"] },
  ]);
  const sources = [
    scanned(
      "components/base/keeper/tests/items-store.test.ts",
      relative("../../interfaces/items-store/tests/shared.ts"),
    ),
    scanned(
      "components/modes/notes/tests/store.test.ts",
      relative("../../../base/interfaces/items-store/tests/shared.ts"),
    ),
    scanned("components/modes/notes/tests/notes.test.ts", relative("../../../base/interfaces/notes/tests/shared.ts")),
  ];
  assert.deepEqual(mapBreaks(map, sources), [
    { from: "components/modes/notes/tests/store.test.ts", to: storeShared, rule: "mode-test-reaches-out" },
  ]);
});

test("a shared test imports only the test toolbox, and only a test of an implementing mode imports it", () => {
  const map = withModeFolders(mapWithInterfaces, [{ folder: "components/base/keeper", implements: ["items-store"] }]);
  const sources = [
    scanned(storeShared, relative("../../../../../tests/test-toolbox.ts")),
    scanned(storeShared, relative("../../../../../tests/project-fixture.ts")),
    scanned(storeShared, relative("../../../../../bay/words.ts")),
    scanned(storeShared, relative("../../notes/tests/shared.ts")),
    scanned("components/base/keeper/scripts/keep.ts", relative("../../interfaces/items-store/tests/shared.ts")),
    scanned("tests/store.test.ts", relative("../components/base/interfaces/items-store/tests/shared.ts")),
  ];
  assert.deepEqual(mapBreaks(map, sources), [
    { from: storeShared, to: "tests/project-fixture.ts", rule: "shared-test-reaches-out" },
    { from: storeShared, to: "bay/words.ts", rule: "shared-test-reaches-out" },
    { from: storeShared, to: "components/base/interfaces/notes/tests/shared.ts", rule: "shared-test-reaches-out" },
    { from: "components/base/keeper/scripts/keep.ts", to: storeShared, rule: "shared-test-reaches-out" },
    { from: "tests/store.test.ts", to: storeShared, rule: "shared-test-reaches-out" },
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

test("a sealed feature's private files are imported only from inside its folder and from tests/inside/<feature>/", () => {
  const runs = smallMap.features.find((feature) => feature.name === "runs");
  assert.ok(runs);
  assert.deepEqual(sealedFolderOf(runs), { feature: "runs", folder: "bay", entry: "bay/engine.ts" });
  const folder = { feature: "runs", folder: "bay/runs", entry: "bay/runs/runs.ts" };
  const sources = [
    scanned("bay/runs/walk.ts", relative("./engine.ts")),
    scanned("bay/runs/runs.ts", relative("./walk.ts")),
    scanned("bay/broker.ts", `${relative("./runs/runs.ts")}\n${relative("./runs/walk.ts")}`),
    scanned("tests/runs.test.ts", relative("../bay/runs/engine.ts")),
    scanned("tests/inside/runs/crash.test.ts", relative("../../../bay/runs/engine.ts")),
    scanned("tests/inside/words/walk.test.ts", relative("../../../bay/runs/walk.ts")),
    scanned("adapters/harness/tests/x.test.ts", relative("../../../bay/runs/walk.ts")),
  ];
  assert.deepEqual(reachesIntoFolder(folder, sources), [
    "bay/broker.ts -> bay/runs/walk.ts",
    "tests/runs.test.ts -> bay/runs/engine.ts",
    "tests/inside/words/walk.test.ts -> bay/runs/walk.ts",
    "adapters/harness/tests/x.test.ts -> bay/runs/walk.ts",
  ]);
});

test("a feature with more than one entry file in its folder is not sealed in a folder", () => {
  const map = parsedMap(stringify({ features: { words: { entry: ["bay/a.ts", "bay/b.ts"], private: ["bay/c.ts"] } } }));
  const [words] = map.features;
  assert.ok(words);
  assert.equal(sealedFolderOf(words), undefined);
});

test("a feature whose private files share one folder is sealed there, with the one entry file in that folder", () => {
  const map = parsedMap(
    stringify({
      features: {
        broker: { entry: ["bay/broker/broker.ts", "bay/sdk.ts"], private: ["bay/broker/rule.ts"] },
        toolbox: { entry: ["bay/sdk.ts", "bay/broker/broker.ts"], private: ["bay/broker/rule.ts"] },
        spread: { entry: ["bay/broker/broker.ts", "bay/sdk.ts"], private: ["bay/broker/rule.ts", "bay/rule.ts"] },
      },
    }),
  );
  assert.deepEqual(
    map.features.map((feature) => sealedFolderOf(feature)),
    [
      { feature: "broker", folder: "bay/broker", entry: "bay/broker/broker.ts" },
      { feature: "toolbox", folder: "bay/broker", entry: "bay/broker/broker.ts" },
      undefined,
    ],
  );
});

test("an entry file's export ... from lines are found, over one line or several, and nothing else is", () => {
  const text = [
    'import { a } from "./a.ts";',
    "export type { B } from './b.ts';",
    'export * from "./c.ts";',
    "export {",
    "  d,",
    '} from "./d.ts";',
    "export function from(text: string): string {",
    "  return text;",
    "}",
    "export type Shape = { readonly from: string };",
    'export const e = "x";',
  ].join("\n");
  assert.deepEqual(reExportsIn(text), ["export type { B } from '", 'export * from "', 'export {\n  d,\n} from "']);
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

test("the scan of the kit reads files in the kernel, in the modes rule's folder and in every folder the map lists outside it", () => {
  const files = kitFiles();
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  const folders = map.outside.map((outside) => outside.folder);
  for (const folder of ["bay", "bay/generated", map.modes?.within ?? "", ...folders]) {
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

test("the kit's map names no folder under the modes rule's folder: the rule covers every mode", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  const within = map.modes?.within ?? "";
  assert.equal(within, "components");
  assert.deepEqual(
    map.outside.filter((outside) => isInside(outside.folder, within) || outside.folder === within),
    [],
  );
  assert.ok(kitMap().outside.some((outside) => isInside(outside.folder, within)));
});

test("the kit's map lets a mode's tests import from the kit only the test toolbox and the toolbox", () => {
  const modes = parsedMap(readFileSync(mapFile, "utf8")).modes;
  assert.ok(modes);
  assert.deepEqual(modes.testsImportKitThrough, ["tests/test-toolbox.ts"]);
  assert.deepEqual(modes.importsKernelThrough, ["bay/sdk.ts"]);
});

test("the kit's map names the interfaces folder, the shared test's place and that a shared test imports only the test toolbox", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  assert.deepEqual(map.interfaces, {
    within: "components/base/interfaces",
    sharedTest: "tests/shared.ts",
    sharedTestsImportKitThrough: ["tests/test-toolbox.ts"],
  });
});

test("every kernel file of the kit is in exactly one feature", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  assert.deepEqual(coverageProblems(map, kitFiles().filter(isKernelFile)), []);
});

test("the kit's imports and its tests' imports break the feature map only where the debt file says so", () => {
  const map = kitMap();
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

test("no file outside a sealed feature's folder imports its private files, and its entry file re-exports nothing", () => {
  const map = parsedMap(readFileSync(mapFile, "utf8"));
  const sealed = map.features
    .filter((feature) => featuresSealedInTheirFolder.includes(feature.name))
    .flatMap((feature) => sealedFolderOf(feature) ?? []);
  assert.deepEqual(
    sealed.map((folder) => folder.feature),
    featuresSealedInTheirFolder,
  );
  const sources = [...kitFiles(), ...typeScriptFiles([testFolder])].map((file) =>
    scanned(file, readFileSync(file, "utf8")),
  );
  for (const folder of sealed) {
    assert.deepEqual(reachesIntoFolder(folder, sources), [], folder.feature);
    assert.deepEqual(reExportsIn(readFileSync(folder.entry, "utf8")), [], folder.entry);
  }
});
