import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { newAction, newInterface, newMode, newSkill, newWorkflow, type Generated, type Workspace } from "../bay/new.ts";
import { isRecord, type Problem } from "../bay/spec.ts";
import { checkFake, cleanFiles } from "./check-fixture.ts";
import { fakeFileSystem, type FakeFileSystem } from "./fakes.ts";
import { layout, rooted } from "./system-fixture.ts";

type Setup = {
  readonly files: FakeFileSystem;
  readonly workspace: Workspace;
};

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function filesBelow(folder: string): readonly string[] {
  return readdirSync(join(repositoryRoot, folder)).flatMap((name) => {
    const path = `${folder}/${name}`;
    return statSync(join(repositoryRoot, path)).isDirectory() ? filesBelow(path) : [path];
  });
}

function templateFiles(): Record<string, string> {
  return Object.fromEntries(
    filesBelow("bay/templates").map((path) => [path, readFileSync(join(repositoryRoot, path), "utf8")]),
  );
}

function setup(extra: Readonly<Record<string, string>> = {}): Setup {
  const files = fakeFileSystem(rooted({ ...cleanFiles(), ...templateFiles(), ...extra }));
  return { files, workspace: { files, root: layout.root } };
}

function written(outcome: Generated): readonly string[] {
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

function refusal(outcome: Generated, words: string): Problem {
  assert.ok(!outcome.ok, "expected the generator to refuse");
  const found = outcome.problems.find((problem) => problem.message.includes(words));
  assert.ok(found, `no problem saying "${words}"; got:\n${JSON.stringify(outcome.problems, null, 2)}`);
  return found;
}

function yamlValue(source: string): unknown {
  const value: unknown = parse(source);
  return value;
}

function member(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function text(files: FakeFileSystem, path: string): string {
  const content = files.contents.get(`${layout.root}/${path}`);
  assert.ok(content !== undefined, `${path} was not written`);
  return content;
}

test("a generated mode, action, skill, workflow and interface pass check with no findings", async () => {
  const { files, workspace } = setup();
  written(await newMode(workspace, "digest", "modes"));
  written(await newAction(workspace, "digest", "summarize"));
  written(await newSkill(workspace, "digest", "write-summary"));
  written(await newWorkflow(workspace, "digest", "daily"));
  written(await newInterface(workspace, "alerts"));
  const report = await checkFake(files);
  assert.deepEqual(report.findings, [], JSON.stringify(report.findings, null, 2));
});

test("newMode writes the manifest and a README into the chosen tier", async () => {
  const { files, workspace } = setup();
  const paths = written(await newMode(workspace, "ledger", "base"));
  assert.deepEqual(paths, ["components/base/ledger/mode.yaml", "components/base/ledger/README.md"]);
  assert.deepEqual(yamlValue(text(files, "components/base/ledger/mode.yaml")), {
    name: "ledger",
    version: "0.1.0",
    description: "Replace this line with one sentence on what mode ledger does.",
    actions: {},
  });
});

test("newMode refuses a name that exists in either tier, a folder that exists and a bad name", async () => {
  const { files, workspace } = setup();
  const before = new Map(files.contents);
  refusal(await newMode(workspace, "store", "modes"), "components/base/store already exists");
  refusal(await newMode(workspace, "interfaces", "base"), "components/base/interfaces already exists");
  refusal(await newMode(workspace, "Daily_Digest", "modes"), 'The mode name "Daily_Digest" is not kebab-case.');
  refusal(await newMode(workspace, "constructor", "modes"), "The mode name constructor is reserved");
  assert.deepEqual(files.contents, before);
});

test("newAction writes schemas, a script and an example, and adds the action to mode.yaml", async () => {
  const { files, workspace } = setup();
  const paths = written(await newAction(workspace, "notes", "tidy"));
  assert.deepEqual(paths, [
    "components/modes/notes/schemas/tidy-input.json",
    "components/modes/notes/schemas/tidy-output.json",
    "components/modes/notes/scripts/tidy.ts",
    "components/modes/notes/tests/tidy.example.json",
    "components/modes/notes/mode.yaml",
  ]);
  const actions = member(yamlValue(text(files, "components/modes/notes/mode.yaml")), "actions");
  assert.deepEqual(isRecord(actions) ? Object.keys(actions) : [], ["add", "tidy"]);
  assert.deepEqual(member(actions, "tidy"), {
    input: "schemas/tidy-input.json",
    output: "schemas/tidy-output.json",
    effects: ["read"],
    run: [{ script: "scripts/tidy.ts" }],
  });
  assert.match(text(files, "components/modes/notes/scripts/tidy.ts"), /from "\.\.\/\.\.\/\.\.\/\.\.\/bay\/sdk\.ts"/);
});

test("newAction keeps the comments and the key order of mode.yaml", async () => {
  const manifest = [
    "# The notes mode.",
    "name: notes",
    "version: 1.0.0 # bumped by hand",
    "description: Writes notes.",
    "",
    "# Its actions.",
    "actions: {}",
    "",
    "# Its workflows, listed last on purpose.",
    "workflows: []",
    "",
  ].join("\n");
  const { files, workspace } = setup({ "components/modes/notes/mode.yaml": manifest });
  written(await newAction(workspace, "notes", "tidy"));
  written(await newWorkflow(workspace, "notes", "weekly"));
  const result = text(files, "components/modes/notes/mode.yaml");
  for (const comment of ["# The notes mode.", "# bumped by hand", "# Its actions.", "# Its workflows, listed last"]) {
    assert.ok(result.includes(comment), `lost the comment ${comment}:\n${result}`);
  }
  const keys = result
    .split("\n")
    .filter((line) => /^[a-z]+:/.test(line))
    .map((line) => line.slice(0, line.indexOf(":")));
  assert.deepEqual(keys, ["name", "version", "description", "actions", "workflows"]);
  assert.match(result, /actions:\n {2}tidy:\n {4}input: schemas\/tidy-input.json/);
});

test("newAction refuses an unknown mode, an existing action, a bad name and an existing file", async () => {
  const { files, workspace } = setup({ "components/modes/notes/scripts/tidy.ts": "" });
  const before = new Map(files.contents);
  const unknown = refusal(await newAction(workspace, "nobody", "tidy"), "There is no mode nobody");
  assert.match(unknown.message, /neither components\/base\/nobody or components\/modes\/nobody has a mode\.yaml/);
  refusal(await newAction(workspace, "notes", "add"), "components/modes/notes/mode.yaml already has an action add.");
  refusal(await newAction(workspace, "notes", "Tidy"), 'The action name "Tidy" is not kebab-case.');
  refusal(
    await newAction(workspace, "notes", "tidy"),
    "components/modes/notes/scripts/tidy.ts already exists; bay new never overwrites a file.",
  );
  refusal(await newAction(workspace, "nobody", "Bad"), "is not kebab-case");
  assert.deepEqual(files.contents, before);
});

test("newSkill writes a SKILL.md with the seven sections in order", async () => {
  const { files, workspace } = setup();
  written(await newSkill(workspace, "notes", "summarize"));
  const skill = text(files, "components/modes/notes/skills/summarize/SKILL.md");
  const headings = skill.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(headings, [
    "## Input",
    "## Output",
    "## Definition of done",
    "## Instructions",
    "## Tools",
    "## Resources",
    "## Rules and constraints",
  ]);
  assert.match(skill, /^---\nname: summarize\n/);
  refusal(await newSkill(workspace, "notes", "summarize"), "SKILL.md already exists");
});

test("newWorkflow writes the workflow and lists it in mode.yaml, once", async () => {
  const { files, workspace } = setup();
  written(await newWorkflow(workspace, "notes", "weekly"));
  const manifest = yamlValue(text(files, "components/modes/notes/mode.yaml"));
  assert.deepEqual(member(manifest, "workflows"), ["workflows/daily.yaml", "workflows/weekly.yaml"]);
  assert.equal(member(yamlValue(text(files, "components/modes/notes/workflows/weekly.yaml")), "name"), "weekly");
  refusal(await newWorkflow(workspace, "notes", "weekly"), "already lists the workflow workflows/weekly.yaml");
});

test("newWorkflow adds a workflows list to a mode that has none", async () => {
  const { files, workspace } = setup();
  written(await newWorkflow(workspace, "store", "nightly"));
  const manifest = yamlValue(text(files, "components/base/store/mode.yaml"));
  assert.deepEqual(member(manifest, "workflows"), ["workflows/nightly.yaml"]);
});

test("newInterface writes the interface file and refuses one that exists", async () => {
  const { files, workspace } = setup();
  written(await newInterface(workspace, "alerts"));
  assert.deepEqual(yamlValue(text(files, "components/base/interfaces/alerts.yaml")), {
    name: "alerts",
    version: 1,
    actions: {},
  });
  refusal(await newInterface(workspace, "items-store"), "items-store.yaml already exists");
  refusal(await newInterface(workspace, "-x"), 'The interface name "-x" is not kebab-case.');
});

test("a missing template is reported and nothing is written", async () => {
  const files = fakeFileSystem(rooted(cleanFiles()));
  const outcome = await newInterface({ files, root: layout.root }, "alerts");
  refusal(outcome, "The template bay/templates/interface/interface.yaml is missing.");
  assert.equal(files.contents.has(`${layout.root}/components/base/interfaces/alerts.yaml`), false);
});
