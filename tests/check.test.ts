import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCheck, type CheckReport } from "../bay/check.ts";
import { layoutOf } from "../bay/layout.ts";
import {
  assertClean,
  check,
  checkFake,
  cleanFiles,
  findFinding,
  notesSkillFile,
  skillSections,
  skillText,
  withoutFinding,
} from "./check-fixture.ts";
import { fakeFileSystem, type FakeFileSystem } from "./fakes.ts";
import { config, notesMode, paths, rooted, schemaText, storeMode, yamlText } from "./system-fixture.ts";

test("a valid system with complete skills, examples and limits passes with no findings", async () => {
  const report = await check(cleanFiles());
  assertClean(report);
  assert.equal(report.errors, 0);
  assert.equal(report.warnings, 0);
});

test("registry problems, skill problems and layout problems are all reported at once", async () => {
  const report = await check({
    ...cleanFiles(),
    [paths.notes]: `${yamlText(notesMode)}colour: blue\n`,
    [notesSkillFile]: skillText([skillSections.input]),
    "components/base/store/playbook.md": "old",
  });
  const registry = findFinding(report, paths.notes, "has the field colour, which is not allowed here");
  assert.equal(registry.severity, "error");
  findFinding(report, "components/base/store/playbook.md", "holds playbook.md");
  assert.ok(report.errors >= 2);
});

test("a listed command in a base mode is a warning", async () => {
  const manifest = yamlText({ ...storeMode, resources: { commands: ["node --test"] } });
  const report = await check({ ...cleanFiles(), [paths.store]: manifest });
  const finding = findFinding(
    report,
    paths.store,
    "Mode store lists the command node --test; a listed command can run code the agent wrote.",
  );
  assert.equal(finding.severity, "warning");
  assert.equal(finding.path, "/resources/commands/0");
  assert.equal(report.errors, 0);
});

test("a listed command in a mode outside components/base is an error", async () => {
  const manifest = yamlText({ ...notesMode, resources: { commands: ["git status"] } });
  const report = await check({ ...cleanFiles(), [paths.notes]: manifest });
  const finding = findFinding(report, paths.notes, "Mode notes lists the command git status");
  assert.equal(finding.severity, "error");
  assert.match(finding.message, /Only a mode under the kit's components\/base\/ may list commands\./);
});

test("the summary groups findings by file, errors first, each with its fix, and ends with the counts", () => {
  const report: CheckReport = {
    findings: [
      { file: "b.yaml", path: "", line: 4, message: "B warns.", fix: "Fix B.", severity: "warning" },
      { file: "c.yaml", path: "", message: "C warns.", severity: "warning" },
      { file: "b.yaml", path: "", line: 9, message: "B fails.", fix: "Fix B again.", severity: "error" },
      { file: "a.yaml", path: "", line: 2, message: "A fails.", fix: "Fix A.", severity: "error" },
    ],
    errors: 2,
    warnings: 2,
  };
  assert.equal(
    summarizeCheck(report),
    [
      "a.yaml:2: error: A fails.",
      "  fix: Fix A.",
      "b.yaml:9: error: B fails.",
      "  fix: Fix B again.",
      "b.yaml:4: warning: B warns.",
      "  fix: Fix B.",
      "c.yaml: warning: C warns.",
      "bay check: 2 errors, 2 warnings.",
    ].join("\n"),
  );
});

test("the summary of a clean report is only the counts", () => {
  assert.equal(summarizeCheck({ findings: [], errors: 0, warnings: 0 }), "bay check: 0 errors, 0 warnings.");
  const one: CheckReport = {
    findings: [{ file: "a.yaml", path: "", message: "A.", severity: "error" }],
    errors: 1,
    warnings: 0,
  };
  assert.match(summarizeCheck(one), /bay check: 1 error, 0 warnings\.$/);
});

const separate = layoutOf({ kit: "/kit", project: "/project" });

function separateFiles(project: Readonly<Record<string, string>>): FakeFileSystem {
  const kit = Object.entries(cleanFiles()).filter(
    ([path]) => path !== paths.config && path !== "framework/limits.yaml",
  );
  return fakeFileSystem({
    ...Object.fromEntries(kit.map(([path, text]) => [`/kit/${path}`, text])),
    ...Object.fromEntries(Object.entries(project).map(([path, text]) => [`/project/${path}`, text])),
  });
}

const journalFolder = "components/modes/journal";

function journalFiles(script: string): Record<string, string> {
  const journal = {
    name: "journal",
    version: "1.0.0",
    description: "Keeps a journal.",
    actions: {
      write: {
        description: "When the owner writes an entry.",
        input: "schemas/in.json",
        output: "schemas/out.json",
        effects: ["read"],
        run: [{ script: "scripts/write.ts" }],
      },
    },
  };
  return {
    [`${journalFolder}/mode.yaml`]: yamlText(journal),
    [`${journalFolder}/schemas/in.json`]: schemaText("in"),
    [`${journalFolder}/schemas/out.json`]: schemaText("out"),
    [`${journalFolder}/scripts/write.ts`]: script,
    [`${journalFolder}/tests/write.example.json`]: JSON.stringify({ input: {}, output: {} }),
  };
}

const sdkScript =
  'import { defineScript } from "agentbay/sdk";\n\nexport const run = defineScript((input) => Promise.resolve(input));\n';

test("bay check in a separate project does not demand framework/limits.yaml or check the kit's own layout", async () => {
  const files = separateFiles({ "agentbay.config.yaml": yamlText(config), ...journalFiles(sdkScript) });
  await files.writeAtomic("/kit/components/extra/notes.md", "a folder the kit's layout does not name");
  await files.writeAtomic("/kit/bay/a.ts", 'import "./b.ts";\n');
  await files.writeAtomic("/kit/bay/b.ts", 'import "./a.ts";\n');
  const report = await checkFake(files, separate);
  assertClean(report);
  const inKit = await checkFake(files, layoutOf({ kit: "/kit", project: "/kit" }));
  findFinding(inKit, "framework/limits.yaml", "framework/limits.yaml does not exist.");
  findFinding(inKit, "components/extra", "components/ holds extra");
  findFinding(inKit, "bay/a.ts", "Kernel files import each other in a cycle");
});

test("bay check in a separate project checks its own modes and every active kit mode, showing kit files as kit:", async () => {
  const files = separateFiles({
    "agentbay.config.yaml": yamlText({ ...config, bindings: { notes: "notes", "items-store": "store" }, settings: {} }),
    ...journalFiles(sdkScript),
    [`${journalFolder}/playbook.md`]: "old",
  });
  await files.writeAtomic("/kit/components/modes/notes/playbook.md", "old");
  await files.writeAtomic("/kit/components/modes/briefing/playbook.md", "old");
  const report = await checkFake(files, separate);
  findFinding(report, `${journalFolder}/playbook.md`, `The mode folder ${journalFolder} holds playbook.md`);
  assert.deepEqual(
    report.findings.map((finding) => finding.file),
    [`${journalFolder}/playbook.md`],
    JSON.stringify(report.findings, null, 2),
  );
  const listed = separateFiles({
    "agentbay.config.yaml": yamlText({ ...config, modes: ["notes"] }),
    ...journalFiles(sdkScript),
  });
  await listed.writeAtomic("/kit/components/modes/notes/playbook.md", "old");
  await listed.writeAtomic("/kit/components/modes/briefing/playbook.md", "old");
  const active = await checkFake(listed, separate);
  findFinding(
    active,
    "kit:components/modes/notes/playbook.md",
    "The mode folder kit:components/modes/notes holds playbook.md",
  );
  withoutFinding(active, "components/modes/briefing holds");
});

test("bay check in a separate project warns once for each kit mode that does not load", async () => {
  const files = separateFiles({ "agentbay.config.yaml": yamlText(config), ...journalFiles(sdkScript) });
  await files.writeAtomic("/kit/components/modes/todo/mode.yaml", "apiVersion: agentbay/v4\nkind: Mode\n");
  const report = await checkFake(files, separate);
  assert.equal(report.errors, 0, JSON.stringify(report.findings, null, 2));
  assert.equal(report.warnings, 1);
  const notice = findFinding(report, "kit:components/modes/todo/mode.yaml", "Mode todo of the kit does not load");
  assert.equal(notice.severity, "warning");
});

test("a project script imports the SDK only as agentbay/sdk, never by a path to the kit", async () => {
  const relativeScript = sdkScript.replace('"agentbay/sdk"', '"../../../../bay/sdk.ts"');
  const otherScript = sdkScript.replace('"agentbay/sdk"', '"agentbay/kernel"');
  for (const [script, words] of [
    [relativeScript, "imports ../../../../bay/sdk.ts, which resolves to bay/sdk.ts, outside the mode folder"],
    [otherScript, "imports the package agentbay/kernel; mode code has no dependencies in 5.0.0."],
  ] as const) {
    const files = separateFiles({ "agentbay.config.yaml": yamlText(config), ...journalFiles(script) });
    const finding = findFinding(await checkFake(files, separate), `${journalFolder}/scripts/write.ts`, words);
    assert.match(finding.message + (finding.fix ?? ""), /agentbay\/sdk/);
  }
});

function journalManifest(descriptionLines: readonly string[]): string {
  return [
    "name: journal",
    "version: 1.0.0",
    "description: Keeps a journal.",
    "actions:",
    "  write:",
    ...descriptionLines,
    "    input: schemas/in.json",
    "    output: schemas/out.json",
    "    effects: [read]",
    "    run:",
    "      - script: scripts/write.ts",
    "",
  ].join("\n");
}

function journalWith(descriptionLines: readonly string[]): FakeFileSystem {
  return separateFiles({
    "agentbay.config.yaml": yamlText(config),
    ...journalFiles(sdkScript),
    [`${journalFolder}/mode.yaml`]: journalManifest(descriptionLines),
  });
}

const descriptionWanted = "One sentence saying when an owner or a mode would use the action.";

test("bay check refuses an action with no description, naming the action, the file, the line and what to write", async () => {
  const report = await checkFake(journalWith([]), separate);
  assert.deepEqual(report.findings, [
    {
      severity: "error",
      file: `${journalFolder}/mode.yaml`,
      path: "/actions/write",
      line: 6,
      message: "actions.write is missing the required field description.",
      fix: `Add description. Expected: ${descriptionWanted}`,
    },
  ]);
});

test("bay check refuses an action whose description is empty or only spaces, and says what to write", async () => {
  for (const blank of ['""', '"   "']) {
    const report = await checkFake(journalWith([`    description: ${blank}`]), separate);
    assert.deepEqual(report.findings, [
      {
        severity: "error",
        file: `${journalFolder}/mode.yaml`,
        path: "/actions/write/description",
        line: 6,
        message: `actions.write.description is not in the expected form. Expected: ${descriptionWanted}`,
      },
    ]);
  }
});

test("bay check refuses a description key with nothing after it in the words it uses for a missing one", async () => {
  const report = await checkFake(journalWith(["    description:"]), separate);
  assert.deepEqual(report.findings, [
    {
      severity: "error",
      file: `${journalFolder}/mode.yaml`,
      path: "/actions/write/description",
      line: 6,
      message: "actions.write is missing the required field description.",
      fix: `Add description. Expected: ${descriptionWanted}`,
    },
  ]);
});

test("bay check still calls an optional key with nothing after it empty, not missing", async () => {
  const lines = ["    description: When the owner writes an entry.", "    budget:"];
  const report = await checkFake(journalWith(lines), separate);
  assert.deepEqual(report.findings, [
    {
      severity: "error",
      file: `${journalFolder}/mode.yaml`,
      path: "/actions/write/budget",
      line: 7,
      message: "actions.write.budget must be a YAML mapping (key: value pairs), but it is empty.",
    },
  ]);
});

test("bay check accepts an action whose description is one sentence", async () => {
  assertClean(await checkFake(journalWith(["    description: When the owner writes an entry."]), separate));
});

test("bay check reads each mode.yaml once", async () => {
  const files = fakeFileSystem(rooted(cleanFiles()));
  const reads: string[] = [];
  const recording: FakeFileSystem = {
    ...files,
    readText: (path) => {
      reads.push(path);
      return files.readText(path);
    },
  };
  await checkFake(recording);
  assert.equal(reads.filter((path) => path === `/kit/${paths.notes}`).length, 1);
});

test("a listed command in a kit mode outside components/base is an error and not also a warning", async () => {
  const manifest = yamlText({ ...notesMode, resources: { commands: ["git status"] } });
  const report = await check({ ...cleanFiles(), [paths.notes]: manifest });
  const notesFindings = report.findings.filter((finding) => finding.file === paths.notes);
  assert.deepEqual(
    notesFindings.map((finding) => [finding.severity, finding.path]),
    [["error", "/resources/commands/0"]],
  );
});
