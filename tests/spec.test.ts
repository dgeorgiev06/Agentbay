import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkValue,
  isRecord,
  loadSpec,
  parseSkill,
  pointer,
  problemAt,
  type Loaded,
  type Problem,
} from "../bay/spec.ts";
import { fakeFileSystem } from "./fakes.ts";
import { config, itemsStore, notesMode, yamlText } from "./system-fixture.ts";

async function problemsOf(
  kind: "mode" | "interface" | "workflow" | "config",
  text: string,
): Promise<readonly Problem[]> {
  const outcome = await loadSpec(fakeFileSystem({ "/x.yaml": text }), "/x.yaml", kind);
  assert.ok(!outcome.ok, "expected the file to be refused");
  return outcome.problems;
}

function messages(problems: readonly Problem[]): readonly string[] {
  return problems.map((problem) => problem.message);
}

test("a valid manifest loads as its typed value and knows the line of each field", async () => {
  const text = yamlText(notesMode);
  const outcome = await loadSpec(fakeFileSystem({ "/notes/mode.yaml": text }), "/notes/mode.yaml", "mode");
  assert.ok(outcome.ok);
  assert.equal(outcome.value.file, "/notes/mode.yaml");
  assert.deepEqual(outcome.value.value, notesMode);
  const expectedLine = text.split("\n").findIndex((line) => line.includes("call: items-store.put")) + 1;
  assert.equal(outcome.value.lineOf(["actions", "add", "run", 1, "call"]), expectedLine);
  assert.equal(outcome.value.lineOf(["nothing", "here"]), undefined);
});

test("an interface, a workflow and a config each load against their own schema", async () => {
  const workflow = {
    name: "daily",
    trigger: { manual: true },
    steps: [{ id: "each", foreach: "$trigger", steps: [{ id: "add", action: "add" }] }],
  };
  const files = fakeFileSystem({
    "/i.yaml": yamlText(itemsStore),
    "/w.yaml": yamlText(workflow),
    "/c.yaml": yamlText(config),
  });
  assert.ok((await loadSpec(files, "/i.yaml", "interface")).ok);
  assert.ok((await loadSpec(files, "/w.yaml", "workflow")).ok);
  assert.ok((await loadSpec(files, "/c.yaml", "config")).ok);
  assert.ok(!(await loadSpec(files, "/c.yaml", "mode")).ok);
});

test("a missing file is a problem, not an exception", async () => {
  const outcome = await loadSpec(fakeFileSystem(), "/nowhere/mode.yaml", "mode");
  assert.ok(!outcome.ok);
  assert.deepEqual(messages(outcome.problems), ["The file /nowhere/mode.yaml does not exist."]);
});

test("YAML that cannot be read is reported with its line", async () => {
  const problems = await problemsOf("config", "adapter: local\nbindings: {}\nadapter: other\n");
  assert.equal(problems.length, 1);
  assert.equal(problems.at(0)?.line, 3);
  assert.match(problems.at(0)?.message ?? "", /^The YAML cannot be read: Map keys must be unique/);
  assert.equal(problems.at(0)?.fix, "Correct the YAML syntax at this line.");
});

test("a missing required field names the field and the fix", async () => {
  const problems = await problemsOf("config", "bindings: {}\n");
  assert.deepEqual(problems, [
    {
      file: "/x.yaml",
      path: "",
      line: 1,
      message: "This file is missing the required field adapter.",
      fix: "Add adapter.",
    },
  ]);
});

test("a value outside a closed set lists the allowed values", async () => {
  const add = notesMode.actions.add;
  assert.ok(add);
  const mode = { ...notesMode, actions: { add: { ...add, effects: ["read", "erase"] } } };
  const problems = await problemsOf("mode", yamlText(mode));
  assert.deepEqual(messages(problems), [
    'actions.add.effects.1 must be one of "read", "write", "network", "spend", "delete", but it is "erase".',
  ]);
  assert.equal(problems.at(0)?.path, "/actions/add/effects/1");
});

test("a name that is not kebab-case says what form is expected", async () => {
  const problems = await problemsOf("mode", yamlText({ ...notesMode, name: "Notes_Mode" }));
  assert.deepEqual(messages(problems), [
    "name is not in the expected form. Expected: Kebab-case, starting with a letter; " +
      "not constructor, a name every JavaScript object has.",
  ]);
});

test("a step is checked against the kind its first field names, without noise from the other kinds", async () => {
  const add = notesMode.actions.add;
  assert.ok(add);
  const mode = { ...notesMode, actions: { add: { ...add, run: [{ skill: "skills/write-note" }] } } };
  const problems = await problemsOf("mode", yamlText(mode));
  assert.deepEqual(messages(problems), ["actions.add.run.0 is missing the required field tier."]);
});

test("a step of no known kind lists the kinds there are", async () => {
  const add = notesMode.actions.add;
  assert.ok(add);
  const mode = { ...notesMode, actions: { add: { ...add, run: [{ program: "x.ts" }] } } };
  const problems = await problemsOf("mode", yamlText(mode));
  assert.deepEqual(messages(problems), ["actions.add.run.0 must have exactly one of the fields script, skill, call."]);
});

test("a step with two kinds is told which field does not belong", async () => {
  const workflow = { name: "daily", steps: [{ id: "add", action: "add", wait: "2d" }] };
  const problems = await problemsOf("workflow", yamlText(workflow));
  assert.deepEqual(messages(problems), ["steps.0 has the field wait, which is not allowed here."]);
});

test("every schema problem in a file is reported at once", async () => {
  const problems = await problemsOf("mode", yamlText({ ...notesMode, version: "one", colour: "blue" }));
  assert.equal(problems.length, 2);
  assert.ok(messages(problems).includes("This file has the field colour, which is not allowed here."));
  assert.ok(messages(problems).some((message) => message.startsWith("version is not in the expected form.")));
});

test("pointer escapes segments as JSON pointers do", () => {
  assert.equal(pointer([]), "");
  assert.equal(pointer(["actions", "a/b", 0, "x~y"]), "/actions/a~1b/0/x~0y");
});

test("problemAt places a problem at a path with its line when the line is known", () => {
  const loaded: Loaded<null> = { file: "f.yaml", value: null, lineOf: (path) => (path.length === 1 ? 4 : undefined) };
  assert.deepEqual(problemAt(loaded, ["name"], { message: "Bad.", fix: "Fix it." }), {
    file: "f.yaml",
    path: "/name",
    line: 4,
    message: "Bad.",
    fix: "Fix it.",
  });
  assert.deepEqual(problemAt(loaded, ["a", "b"], { message: "Bad." }), {
    file: "f.yaml",
    path: "/a/b",
    message: "Bad.",
  });
});

test("isRecord accepts plain objects only", () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord("text"), false);
});

const skillText = [
  "---",
  "name: digest",
  "description: Writes the digest.",
  "metadata:",
  "  input: schemas/digest-req.json",
  "---",
  "# Digest",
  "## Input",
  "```markdown",
  "## Not a heading",
  "```",
  "## Output",
  "### A level-three heading",
  "## Definition of done",
].join("\n");

test("a SKILL.md is parsed into its front matter and its level-two headings in order", async () => {
  const outcome = await parseSkill(fakeFileSystem({ "/s/SKILL.md": skillText }), "/s/SKILL.md");
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.value.frontMatter, {
    name: "digest",
    description: "Writes the digest.",
    metadata: { input: "schemas/digest-req.json" },
  });
  assert.deepEqual(outcome.value.headings, ["Input", "Output", "Definition of done"]);
});

test("a SKILL.md without front matter is told how to start", async () => {
  const outcome = await parseSkill(fakeFileSystem({ "/s/SKILL.md": "# Digest\n" }), "/s/SKILL.md");
  assert.ok(!outcome.ok);
  assert.equal(outcome.problems.at(0)?.message, "The skill has no front matter between two --- lines at its top.");
  assert.equal(outcome.problems.at(0)?.line, 1);
});

test("a problem in skill front matter carries the line in SKILL.md", async () => {
  const text = "---\nname: digest\ndescription: Writes.\nauthor: me\n---\n## Input\n";
  const outcome = await parseSkill(fakeFileSystem({ "/s/SKILL.md": text }), "/s/SKILL.md");
  assert.ok(!outcome.ok);
  assert.equal(outcome.problems.at(0)?.message, "This file has the field author, which is not allowed here.");
  assert.equal(outcome.problems.at(0)?.line, 4);
});

test("a missing SKILL.md is a problem", async () => {
  const outcome = await parseSkill(fakeFileSystem(), "/s/SKILL.md");
  assert.ok(!outcome.ok);
  assert.equal(outcome.problems.at(0)?.message, "The file /s/SKILL.md does not exist.");
});

test("a config key of agentbay 4, such as offline, is refused by name", async () => {
  const problems = await problemsOf("config", yamlText({ ...config, offline: true }));
  assert.deepEqual(messages(problems), ["This file has the field offline, which is not allowed here."]);
});

test("an interface reference without its major version is refused", async () => {
  const problems = await problemsOf("mode", yamlText({ ...notesMode, requires: { interfaces: ["items-store"] } }));
  assert.deepEqual(messages(problems), [
    "requires.interfaces.0 is not in the expected form. Expected: An interface name and its major version, " +
      "as name@major, for example items-store@1.",
  ]);
});

test("an empty file or a list where a mapping belongs is described in a plain sentence", async () => {
  assert.deepEqual(messages(await problemsOf("config", "")), [
    "This file must be a YAML mapping (key: value pairs), but it is empty.",
  ]);
  assert.deepEqual(messages(await problemsOf("config", "- a\n- b\n")), [
    "This file must be a YAML mapping (key: value pairs), but it is a list.",
  ]);
});

test("a field of the wrong type is named with what it must be and what it is", async () => {
  const problems = await problemsOf("mode", yamlText({ ...notesMode, description: ["a"], actions: [] }));
  assert.deepEqual(messages(problems), [
    "description must be text, but it is a list.",
    "actions must be a YAML mapping (key: value pairs), but it is a list.",
  ]);
});

test("limits on lists, text, numbers and constants are described in plain sentences", async () => {
  const add = notesMode.actions.add;
  assert.ok(add);
  const mode = {
    ...notesMode,
    description: "",
    implements: ["notes@1", "notes@1"],
    actions: { add: { ...add, run: [], budget: { usd: -1 } } },
  };
  assert.deepEqual(messages(await problemsOf("mode", yamlText(mode))), [
    "description must not be empty.",
    "implements lists the same entry twice.",
    "actions.add.run must list at least 1 entry, but it lists fewer.",
    "actions.add.budget.usd must be at least 0, but it is -1.",
  ]);
  const workflow = { name: "daily", trigger: { manual: false }, steps: [{ id: "pause", wait: "1d" }] };
  assert.deepEqual(messages(await problemsOf("workflow", yamlText(workflow))), [
    "trigger.manual must be true, but it is false.",
  ]);
});

test("a key that is not kebab-case is named and placed at the key", async () => {
  const add = notesMode.actions.add;
  assert.ok(add);
  const problems = await problemsOf("mode", yamlText({ ...notesMode, actions: { Add_Note: add } }));
  assert.equal(problems.length, 1);
  assert.match(problems.at(0)?.message ?? "", /^actions has the key Add_Note, which is not in the expected form\./);
  assert.equal(problems.at(0)?.path, "/actions/Add_Note");
});

test("checkValue validates a value against a schema given at run time, with paths under a prefix", () => {
  const loaded: Loaded<null> = { file: "agentbay.config.yaml", value: null, lineOf: () => undefined };
  const place = { loaded, path: ["settings", "briefing"] };
  const schema = { type: "object", required: ["lookback"], properties: { lookback: { type: "string" } } };
  assert.deepEqual(checkValue(schema, { lookback: "3d" }, place), { kind: "checked", problems: [] });
  assert.deepEqual(checkValue(schema, {}, place), {
    kind: "checked",
    problems: [
      {
        file: "agentbay.config.yaml",
        path: "/settings/briefing",
        message: "settings.briefing is missing the required field lookback.",
        fix: "Add lookback.",
      },
    ],
  });
  const unusable = checkValue({ type: "mapping" }, {}, place);
  assert.equal(unusable.kind, "unusable-schema");
  assert.equal(checkValue("not a schema", {}, place).kind, "unusable-schema");
});
