import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { check, checkFake, cleanFiles, findFinding, withoutFinding } from "./check-fixture.ts";
import { fakeFileSystem } from "./fakes.ts";
import { rooted, separateLayout } from "./system-fixture.ts";

const script = "components/modes/notes/scripts/tidy.ts";

async function checkScript(text: string): ReturnType<typeof check> {
  return check({ ...cleanFiles(), [script]: text });
}

test("mode code may import bay/sdk.ts, node: built-ins and files of its own mode", async () => {
  const text = [
    'import { defineScript } from "../../../../bay/sdk.ts";',
    'import { join } from "node:path";',
    'import type { Note } from "./types.ts";',
    'export { helper } from "../schemas/helper.ts";',
    "",
  ].join("\n");
  const report = await checkScript(text);
  withoutFinding(report, "imports");
});

test("a test of a kit mode may import the kit's tests/test-toolbox.ts, and nothing else outside its mode", async () => {
  const test = "components/modes/notes/tests/tidy.test.ts";
  const harness = 'import { openModeProject } from "../../../../tests/test-toolbox.ts";\n';
  const allowed = await check({ ...cleanFiles(), [test]: harness });
  withoutFinding(allowed, "imports");
  const fixture = 'import { kit } from "../../../../tests/project-fixture.ts";\n';
  findFinding(await check({ ...cleanFiles(), [test]: fixture }), test, "which resolves to tests/project-fixture.ts");
  findFinding(await checkScript(harness), script, "which resolves to tests/test-toolbox.ts");
});

const storeShared = "components/base/interfaces/items-store/tests/shared.ts";

const notesShared = "components/base/interfaces/notes/tests/shared.ts";

const sharedTestText = 'import { openModeProject } from "../../../../../tests/test-toolbox.ts";\n';

test("a mode's test may import the shared test of an interface its mode implements, and not another interface's", async () => {
  const storeTest = "components/base/store/tests/items-store.test.ts";
  const notesTest = "components/modes/notes/tests/notes.test.ts";
  const report = await check({
    ...cleanFiles(),
    [storeShared]: sharedTestText,
    [notesShared]: sharedTestText,
    [storeTest]: 'import { testItemsStore } from "../../interfaces/items-store/tests/shared.ts";\n',
    [notesTest]: [
      'import { testNotes } from "../../../base/interfaces/notes/tests/shared.ts";',
      'import { testItemsStore } from "../../../base/interfaces/items-store/tests/shared.ts";',
      "",
    ].join("\n"),
  });
  const finding = findFinding(report, notesTest, `which resolves to ${storeShared}`);
  assert.equal(finding.line, 2);
  withoutFinding(report, "../../interfaces/items-store/tests/shared.ts");
  withoutFinding(report, "../../../base/interfaces/notes/tests/shared.ts");
  withoutFinding(report, "whose shared test");
});

const storeTest = "components/base/store/tests/items-store.test.ts";

const unrunMessage =
  `Mode store implements items-store@1, whose shared test ${storeShared} no test of the mode runs, ` +
  "so nothing shows that the mode does what the interface means.";

const unrunFix =
  "Add a test file under components/base/store/tests/ that imports the function " +
  '../../interfaces/items-store/tests/shared.ts exports and calls it with { mode: "store" }. ' +
  "An import of its types alone, or of the file for its side effects, runs nothing.";

async function checkStoreTest(text: string): ReturnType<typeof check> {
  return check({ ...cleanFiles(), [storeShared]: sharedTestText, [storeTest]: text });
}

test("a mode that implements an interface with a shared test, and has no test that imports it, is reported with a fix", async () => {
  const storeScript = "components/base/store/scripts/put.ts";
  const report = await check({
    ...cleanFiles(),
    [storeShared]: sharedTestText,
    [storeScript]: 'import { testItemsStore } from "../../interfaces/items-store/tests/shared.ts";\n',
  });
  const finding = findFinding(report, "components/base/store/mode.yaml", unrunMessage);
  assert.equal(finding.fix, unrunFix);
  assert.equal(finding.severity, "error");
  findFinding(report, storeScript, `which resolves to ${storeShared}`);
  withoutFinding(report, "Mode notes implements");
});

function keeperManifest(commands: Readonly<Record<string, unknown>>): string {
  return stringify({
    name: "keeper",
    version: "1.0.0",
    description: "Keeps items.",
    implements: ["items-store@1"],
    resources: { commands },
    actions: {},
  });
}

const tidyCommand = { tidy: { run: "echo tidy", effects: ["read"] } };

const keeperManifestFile = "components/modes/keeper/mode.yaml";

async function keeperBesideTheKit(commands: Readonly<Record<string, unknown>>): ReturnType<typeof check> {
  const files = {
    ...rooted({ ...cleanFiles(), [storeShared]: sharedTestText }),
    "/project/agentbay.config.yaml": stringify({ adapter: "fake", bindings: {} }),
    [`/project/${keeperManifestFile}`]: keeperManifest(commands),
  };
  return checkFake(fakeFileSystem(files), separateLayout);
}

function keeperFix(from: string, secondArgument: string): string {
  return (
    "Add a test file under components/modes/keeper/tests/ that imports the function " +
    `${from} exports and calls it with { mode: "keeper" } and, as its second argument, ${secondArgument}. ` +
    "An import of its types alone, or of the file for its side effects, runs nothing."
  );
}

const fromTheProject = "../../../../../kit/components/base/interfaces/items-store/tests/shared.ts";

test("a mode in a project beside the kit that lists a command, and runs no shared test, is told to give its project and to trust it", async () => {
  const report = await keeperBesideTheKit(tidyCommand);
  const finding = findFinding(report, keeperManifestFile, "no test of the mode runs");
  assert.equal(finding.fix, keeperFix(fromTheProject, '{ project: import.meta.dirname, trusted: ["keeper"] }'));
});

test("a mode in a project beside the kit that lists nothing, and runs no shared test, is told to give its project only", async () => {
  const report = await keeperBesideTheKit({});
  const finding = findFinding(report, keeperManifestFile, "no test of the mode runs");
  assert.equal(finding.fix, keeperFix(fromTheProject, "{ project: import.meta.dirname }"));
});

test("a mode of the kit outside components/base/ that lists a command, and runs no shared test, is told to trust it", async () => {
  const report = await check({
    ...cleanFiles(),
    [storeShared]: sharedTestText,
    [keeperManifestFile]: keeperManifest(tidyCommand),
  });
  const finding = findFinding(report, keeperManifestFile, "no test of the mode runs");
  assert.equal(
    finding.fix,
    keeperFix("../../../base/interfaces/items-store/tests/shared.ts", '{ trusted: ["keeper"] }'),
  );
});

test("a mode of the kit's components/base/ that lists a command, and runs no shared test, is told no second argument", async () => {
  const baseKeeper = "components/base/keeper/mode.yaml";
  const report = await check({
    ...cleanFiles(),
    [storeShared]: sharedTestText,
    [baseKeeper]: keeperManifest(tidyCommand),
  });
  assert.equal(
    findFinding(report, baseKeeper, "no test of the mode runs").fix,
    "Add a test file under components/base/keeper/tests/ that imports the function " +
      '../../interfaces/items-store/tests/shared.ts exports and calls it with { mode: "keeper" }. ' +
      "An import of its types alone, or of the file for its side effects, runs nothing.",
  );
});

test("a mode whose test imports only types from the shared test with import type does not run it", async () => {
  const report = await checkStoreTest(
    'import type { Files } from "../../interfaces/items-store/tests/shared.ts";\nexport type Seen = Files;\n',
  );
  assert.equal(findFinding(report, "components/base/store/mode.yaml", unrunMessage).fix, unrunFix);
});

test("a mode whose test imports only names marked type from the shared test does not run it", async () => {
  const report = await checkStoreTest(
    'import { type Files, type Start } from "../../interfaces/items-store/tests/shared.ts";\n' +
      "export type Seen = Files | Start;\n",
  );
  assert.equal(findFinding(report, "components/base/store/mode.yaml", unrunMessage).fix, unrunFix);
});

test("a mode whose test imports the shared test only for its side effects does not run it", async () => {
  const report = await checkStoreTest('import "../../interfaces/items-store/tests/shared.ts";\n');
  assert.equal(findFinding(report, "components/base/store/mode.yaml", unrunMessage).fix, unrunFix);
});

test("a mode whose test imports the shared test's function and calls it with the mode runs it", async () => {
  const report = await checkStoreTest(
    [
      'import { testItemsStore, type Files } from "../../interfaces/items-store/tests/shared.ts";',
      'testItemsStore({ mode: "store" });',
      "export type Seen = Files;",
      "",
    ].join("\n"),
  );
  withoutFinding(report, "whose shared test");
});

test("a test that imports the shared test's function and never calls it counts as running it: the check cannot tell", async () => {
  const report = await checkStoreTest(
    'import { testItemsStore } from "../../interfaces/items-store/tests/shared.ts";\nvoid testItemsStore;\n',
  );
  withoutFinding(report, "whose shared test");
});

test("mode code importing another mode's file is reported with the resolved path", async () => {
  const report = await checkScript('import { put } from "../../../base/store/scripts/put.ts";\n');
  const finding = findFinding(
    report,
    script,
    "imports ../../../base/store/scripts/put.ts, which resolves to components/base/store/scripts/put.ts, " +
      "outside the mode folder components/modes/notes",
  );
  assert.equal(finding.line, 1);
});

test("mode code importing a kernel file other than bay/sdk.ts is reported", async () => {
  const report = await checkScript('const a = 1;\nimport {\n  loadSystem,\n} from "../../../../bay/registry.ts";\n');
  const finding = findFinding(report, script, "which resolves to bay/registry.ts");
  assert.equal(finding.line, 2);
});

test("a bare package import in mode code is reported", async () => {
  const report = await checkScript('import { parse } from "yaml";\nimport fs from "fs";\n');
  findFinding(report, script, "imports the package yaml; mode code has no dependencies in 5.0.0.");
  findFinding(report, script, "imports the package fs;");
});

test("export from, side-effect imports and absolute paths are scanned too", async () => {
  const report = await checkScript('export * from "../../todo/x.ts";\nimport "/etc/hook.ts";\n');
  findFinding(report, script, "which resolves to components/modes/todo/x.ts");
  findFinding(report, script, "imports /etc/hook.ts, which resolves to /etc/hook.ts");
});

test("a dynamic import is scanned, and one with a computed specifier is reported", async () => {
  const text = 'const a = await import("../../store/x.ts");\nconst b = await import(`./${name}.ts`);\n';
  const report = await checkScript(text);
  findFinding(report, script, "which resolves to components/modes/store/x.ts");
  const computed = findFinding(report, script, "calls import() with a specifier that is not a plain string");
  assert.equal(computed.line, 2);
});

test("an import cycle among kernel files is reported once", async () => {
  const report = await check({
    ...cleanFiles(),
    "bay/alpha.ts": 'import { b } from "./beta.ts";\n',
    "bay/beta.ts": 'import { c } from "./gamma.ts";\n',
    "bay/gamma.ts": 'import type { A } from "./alpha.ts";\n',
    "bay/delta.ts": 'import { a } from "./alpha.ts";\n',
  });
  const cycles = report.findings.filter((finding) => finding.message.includes("in a cycle"));
  assert.deepEqual(
    cycles.map((finding) => finding.message),
    ["Kernel files import each other in a cycle: bay/alpha.ts -> bay/beta.ts -> bay/gamma.ts -> bay/alpha.ts."],
  );
  assert.equal(cycles[0]?.file, "bay/alpha.ts");
});

test("a kernel file importing cli.ts, mcp.ts or an adapter is reported, and cli.ts may", async () => {
  const report = await check({
    ...cleanFiles(),
    "bay/engine.ts": 'import { main } from "./cli.ts";\nimport { serve } from "./mcp.ts";\n',
    "bay/policy.ts": 'import { hook } from "../adapters/claude-code/hook.ts";\n',
    "bay/cli.ts": 'import { hook } from "../adapters/claude-code/hook.ts";\nimport { serve } from "./mcp.ts";\n',
  });
  findFinding(report, "bay/engine.ts", "bay/engine.ts imports bay/cli.ts; the kernel core never imports cli.ts");
  findFinding(report, "bay/engine.ts", "bay/engine.ts imports bay/mcp.ts");
  findFinding(report, "bay/policy.ts", "imports adapters/claude-code/hook.ts");
  assert.ok(!report.findings.some((finding) => finding.file === "bay/cli.ts"));
});

test("the evaluator's dodges are each reported", async () => {
  const dodges = [
    'const a = await import/**/("../../store/x.ts");\n',
    'import {a}from"../../store/x.ts";\n',
    'import /* c */ { a } from "../../store/x.ts";\n',
    'import { "string name" as a } from "../../store/x.ts";\n',
  ];
  for (const text of dodges) {
    findFinding(await checkScript(text), script, "which resolves to components/modes/store/x.ts");
  }
});

test("an import written inside a string, a comment or a template is not an import", async () => {
  const text = [
    "const text = \"import { a } from 'yaml'\";",
    '// import { b } from "yaml";',
    'const more = `import { c } from "yaml"`;',
    "",
  ].join("\n");
  withoutFinding(await checkScript(text), "imports");
});
