import assert from "node:assert/strict";
import { test } from "node:test";
import { check, cleanFiles, findFinding, withoutFinding } from "./check-fixture.ts";
import { notesMode, paths, yamlText } from "./system-fixture.ts";

const notesFolder = "components/modes/notes";

function without(files: Readonly<Record<string, string>>, removed: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== removed));
}

test("an entry the mode-folder layout does not name is reported once per entry", async () => {
  const report = await check({
    ...cleanFiles(),
    [`${notesFolder}/playbook.md`]: "old",
    [`${notesFolder}/features/a.md`]: "old",
    [`${notesFolder}/features/b.md`]: "old",
    [`${notesFolder}/README.md`]: "# notes\n",
  });
  const finding = findFinding(
    report,
    `${notesFolder}/features`,
    `The mode folder ${notesFolder} holds features/, which the mode-folder layout does not name.`,
  );
  assert.match(
    finding.fix ?? "",
    /mode\.yaml, README\.md, skills\/, scripts\/, workflows\/, schemas\/, migrations\/, tests\//,
  );
  findFinding(report, `${notesFolder}/playbook.md`, "holds playbook.md");
  assert.equal(report.findings.filter((entry) => entry.message.includes("holds features/")).length, 1);
  withoutFinding(report, "holds README.md");
});

test("a mode folder may hold the top-level files its manifest lists under extraFiles, and no others", async () => {
  const report = await check({
    ...cleanFiles(),
    [paths.notes]: yamlText({ ...notesMode, extraFiles: ["lint.json", "practices.md", "config"] }),
    [`${notesFolder}/lint.json`]: "{}",
    [`${notesFolder}/practices.md`]: "# Practices\n",
    [`${notesFolder}/other.json`]: "{}",
    [`${notesFolder}/config/rules.json`]: "{}",
  });
  withoutFinding(report, "holds lint.json");
  withoutFinding(report, "holds practices.md");
  findFinding(
    report,
    `${notesFolder}/other.json`,
    `The mode folder ${notesFolder} holds other.json, which the mode-folder layout does not name.`,
  );
  findFinding(
    report,
    `${notesFolder}/config`,
    `The mode folder ${notesFolder} holds config/, which the mode-folder layout does not name.`,
  );
});

test("a skill folder without SKILL.md is reported", async () => {
  const report = await check({ ...cleanFiles(), [`${notesFolder}/skills/draft/notes.md`]: "text" });
  findFinding(report, `${notesFolder}/skills/draft`, `The skill folder ${notesFolder}/skills/draft has no SKILL.md.`);
});

test("a file under scripts/ that is not .ts is reported", async () => {
  const report = await check({ ...cleanFiles(), [`${notesFolder}/scripts/clean.py`]: "print(1)\n" });
  findFinding(report, `${notesFolder}/scripts/clean.py`, "holds clean.py, which is not a .ts file");
});

test("a migration that is not named NNNN-name.sql is reported", async () => {
  const report = await check({
    ...cleanFiles(),
    [`${notesFolder}/migrations/0001-create-notes.sql`]: "",
    [`${notesFolder}/migrations/2-add-index.sql`]: "",
    [`${notesFolder}/migrations/0002_Add.sql`]: "",
  });
  findFinding(report, `${notesFolder}/migrations/2-add-index.sql`, "is not named NNNN-name.sql");
  findFinding(report, `${notesFolder}/migrations/0002_Add.sql`, "is not named NNNN-name.sql");
});

test("migration numbers with a gap or a repeat are reported, and 0001, 0002 pass", async () => {
  const gap = await check({
    ...cleanFiles(),
    [`${notesFolder}/migrations/0001-create.sql`]: "",
    [`${notesFolder}/migrations/0003-index.sql`]: "",
    [`${notesFolder}/migrations/0003-again.sql`]: "",
  });
  findFinding(gap, `${notesFolder}/migrations/0003-again.sql`, "has the number 3, but the next number is 0002");
  findFinding(gap, `${notesFolder}/migrations/0003-index.sql`, "has the number 3, but the next number is 0004");
  const ordered = await check({
    ...cleanFiles(),
    [`${notesFolder}/migrations/0001-create.sql`]: "",
    [`${notesFolder}/migrations/0002-index.sql`]: "",
  });
  withoutFinding(ordered, "migration");
});

test("an action without an example is reported", async () => {
  const report = await check(without(cleanFiles(), `${notesFolder}/tests/add.example.json`));
  const finding = findFinding(
    report,
    `${notesFolder}/tests/add.example.json`,
    `Action add of mode notes has no example: ${notesFolder}/tests/add.example.json does not exist.`,
  );
  assert.equal(finding.severity, "error");
});

test("an example that is not JSON, not an object or lacks input or output is reported", async () => {
  const exampleFile = `${notesFolder}/tests/add.example.json`;
  const broken = await check({ ...cleanFiles(), [exampleFile]: "{ input: " });
  findFinding(
    broken,
    exampleFile,
    "The example components/modes/notes/tests/add.example.json of action add is not valid JSON",
  );
  const list = await check({ ...cleanFiles(), [exampleFile]: "[]" });
  findFinding(list, exampleFile, "of action add is not a JSON object.");
  const half = await check({ ...cleanFiles(), [exampleFile]: '{ "input": {} }' });
  findFinding(half, exampleFile, "of action add has no output.");
});

test("an example whose input does not match the action's input schema is reported", async () => {
  const exampleFile = `${notesFolder}/tests/add.example.json`;
  const report = await check({ ...cleanFiles(), [exampleFile]: '{ "input": "text", "output": {} }' });
  findFinding(report, exampleFile, 'input must be a YAML mapping (key: value pairs), but it is "text".');
});

test("components/ holds only base and modes", async () => {
  const report = await check({ ...cleanFiles(), "components/extras/x.yaml": "", "components/README.md": "" });
  findFinding(report, "components/extras", "components/ holds extras, but only base/ and modes/ belong there.");
  findFinding(report, "components/README.md", "components/ holds README.md");
});

test("the interfaces folder holds only interface files and their schema folders", async () => {
  const folder = "components/base/interfaces";
  const report = await check({
    ...cleanFiles(),
    [`${folder}/notes.md`]: "",
    [`${folder}/orphans/a.json`]: "{}",
    [`${folder}/notes/readme.txt`]: "",
  });
  findFinding(report, `${folder}/notes.md`, `${folder} holds notes.md, which is not an interface .yaml file.`);
  findFinding(
    report,
    `${folder}/orphans/a.json`,
    `${folder} has the folder orphans/, but no interface file orphans.yaml`,
  );
  findFinding(report, `${folder}/notes/readme.txt`, "holds readme.txt, which is not a .json schema");
});
