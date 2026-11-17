import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectSystem, loadSystem, type InspectedFolder } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import { config, itemsStore, layout, notesMode, paths, rooted, validFiles, yamlText } from "./system-fixture.ts";

const workflowFile = "components/modes/notes/workflows/daily.yaml";

const notesBindingRefused = {
  file: paths.config,
  path: "/bindings/notes",
  line: 3,
  message: "bindings binds notes to notes, which does not load; its own problems are listed.",
  fix: "Correct the manifest of notes, or bind notes to another mode that implements notes@1.",
};

async function problemsWith(changes: Readonly<Record<string, string>>): Promise<readonly Problem[]> {
  const outcome = await loadSystem(fakeFileSystem(rooted({ ...validFiles(), ...changes })), layout);
  assert.ok(!outcome.ok, "expected the system to be refused");
  return outcome.problems;
}

async function notesProblems(mode: unknown): Promise<readonly Problem[]> {
  return problemsWith({ [paths.notes]: yamlText(mode) });
}

function messages(problems: readonly Problem[]): readonly string[] {
  return problems.map((problem) => problem.message);
}

function addAction(): NonNullable<(typeof notesMode)["actions"]["add"]> {
  const add = notesMode.actions.add;
  assert.ok(add);
  return add;
}

async function readFolder(
  files: Readonly<Record<string, string>>,
  folder: string,
): Promise<Extract<InspectedFolder, { readonly manifest: object }>> {
  const inspection = await inspectSystem(fakeFileSystem(rooted(files)), layout);
  const found = inspection.folders.find((entry) => entry.folder === folder);
  assert.ok(found?.manifest !== undefined, `${folder} was not read`);
  return found;
}

test("a valid manifest loads as its typed value and knows the line of each field", async () => {
  const notes = await readFolder(validFiles(), "/kit/components/modes/notes");
  assert.deepEqual(notes.manifest, notesMode);
  const text = yamlText(notesMode);
  const expectedLine = text.split("\n").findIndex((line) => line.includes("call: items-store.put")) + 1;
  assert.equal(notes.at(["actions", "add", "run", 1, "call"], { message: "Here." }).line, expectedLine);
  assert.deepEqual(notes.at(["nothing", "here"], { message: "Here." }), {
    file: "/kit/components/modes/notes/mode.yaml",
    path: "/nothing/here",
    message: "Here.",
  });
});

test("an interface, a workflow and a config each load against their own schema", async () => {
  const outcome = await loadSystem(fakeFileSystem(rooted(validFiles())), layout);
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  assert.deepEqual(outcome.value.interfaces.get("items-store@1")?.definition, itemsStore);
  assert.equal(outcome.value.workflow("notes", "workflows/daily.yaml").ok, true);
  assert.deepEqual(outcome.value.config, config);
  const configAsMode = await problemsWith({ "components/modes/extra/mode.yaml": yamlText(config) });
  assert.deepEqual(messages(configAsMode), [
    "This file is missing the required field name.",
    "This file is missing the required field version.",
    "This file is missing the required field description.",
    "This file is missing the required field actions.",
    "This file has the field bindings, which is not allowed here.",
    "This file has the field adapter, which is not allowed here.",
    "settings must be text, but it is a mapping.",
  ]);
});

test("YAML that cannot be read is reported with its line", async () => {
  assert.deepEqual(await problemsWith({ [paths.config]: "adapter: local\nbindings: {}\nadapter: other\n" }), [
    {
      file: paths.config,
      path: "",
      line: 3,
      message: "The YAML cannot be read: Map keys must be unique.",
      fix: "Correct the YAML syntax at this line.",
    },
  ]);
});

test("a missing required field names the field and the fix", async () => {
  assert.deepEqual(await problemsWith({ [paths.config]: "bindings: {}\n" }), [
    {
      file: paths.config,
      path: "",
      line: 1,
      message: "This file is missing the required field adapter.",
      fix: "Add adapter. Expected: The adapter that runs skill steps.",
    },
  ]);
});

test("a value outside a closed set lists the allowed values", async () => {
  const mode = { ...notesMode, actions: { add: { ...addAction(), effects: ["read", "erase"] } } };
  assert.deepEqual(await notesProblems(mode), [
    {
      file: paths.notes,
      path: "/actions/add/effects/1",
      line: 14,
      message: 'actions.add.effects.1 must be one of "read", "write", "network", "spend", "delete", but it is "erase".',
    },
    notesBindingRefused,
  ]);
});

test("a name that is not kebab-case says what form is expected", async () => {
  assert.deepEqual(await notesProblems({ ...notesMode, name: "Notes_Mode" }), [
    {
      file: paths.notes,
      path: "/name",
      line: 1,
      message:
        "name is not in the expected form. Expected: Kebab-case, starting with a letter; " +
        "not constructor, a name every JavaScript object has.",
    },
    notesBindingRefused,
  ]);
});

test("a step is checked against the kind its first field names, without noise from the other kinds", async () => {
  const mode = { ...notesMode, actions: { add: { ...addAction(), run: [{ skill: "skills/write-note" }] } } };
  assert.deepEqual(await notesProblems(mode), [
    {
      file: paths.notes,
      path: "/actions/add/run/0",
      line: 16,
      message: "actions.add.run.0 is missing the required field tier.",
      fix: "Add tier. Expected: How capable a model the skill needs.",
    },
    notesBindingRefused,
  ]);
});

test("a step of no known kind lists the kinds there are", async () => {
  const mode = { ...notesMode, actions: { add: { ...addAction(), run: [{ program: "x.ts" }] } } };
  assert.deepEqual(messages(await notesProblems(mode)), [
    "actions.add.run.0 must have exactly one of the fields script, skill, call.",
    notesBindingRefused.message,
  ]);
});

test("a step with two kinds is told which field does not belong", async () => {
  const workflow = { name: "daily", steps: [{ id: "add", action: "add", wait: "2d" }] };
  assert.deepEqual(await problemsWith({ [workflowFile]: yamlText(workflow) }), [
    {
      file: workflowFile,
      path: "/steps/0/wait",
      line: 5,
      message: "steps.0 has the field wait, which is not allowed here.",
      fix: "Remove wait or correct its spelling.",
    },
  ]);
});

test("every schema problem in a file is reported at once", async () => {
  assert.deepEqual(messages(await notesProblems({ ...notesMode, version: "one", colour: "blue" })), [
    "This file has the field colour, which is not allowed here.",
    "version is not in the expected form. Expected: The mode's version, as major.minor.patch.",
    notesBindingRefused.message,
  ]);
});

test("a problem's path escapes segments as JSON pointers do", async () => {
  const notes = await readFolder(validFiles(), "/kit/components/modes/notes");
  const wording = { message: "Bad.", fix: "Fix it." };
  assert.equal(notes.at([], wording).path, "");
  assert.equal(notes.at(["actions", "a/b", 0, "x~y"], wording).path, "/actions/a~1b/0/x~0y");
});

test("a problem placed in a manifest has the line of its path, and no line where the path is not in the file", async () => {
  const notes = await readFolder(validFiles(), "/kit/components/modes/notes");
  assert.deepEqual(notes.at(["name"], { message: "Bad.", fix: "Fix it." }), {
    file: "/kit/components/modes/notes/mode.yaml",
    path: "/name",
    line: 1,
    message: "Bad.",
    fix: "Fix it.",
  });
  assert.deepEqual(notes.at(["a", "b"], { message: "Bad." }), {
    file: "/kit/components/modes/notes/mode.yaml",
    path: "/a/b",
    message: "Bad.",
  });
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

const skillFile = "components/modes/notes/skills/write-note/SKILL.md";

test("a SKILL.md is parsed into its front matter and its level-two headings in order", async () => {
  const notes = await readFolder({ ...validFiles(), [skillFile]: skillText }, "/kit/components/modes/notes");
  const { text } = await notes.skill("skills/write-note");
  assert.ok(text);
  assert.deepEqual(text.frontMatter, {
    ok: true,
    value: { name: "digest", description: "Writes the digest.", metadata: { input: "schemas/digest-req.json" } },
  });
  assert.deepEqual(
    text.sections.map((section) => [section.heading, section.line]),
    [
      ["Input", 8],
      ["Output", 12],
      ["Definition of done", 14],
    ],
  );
});

test("a problem in skill front matter carries the line in SKILL.md", async () => {
  const text = "---\nname: write-note\ndescription: Writes.\nauthor: me\n---\n## Input\n";
  const outcome = await loadSystem(fakeFileSystem(rooted({ ...validFiles(), [skillFile]: text })), layout);
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  const skill = await outcome.value.modes.get("notes")?.skill("skills/write-note");
  assert.deepEqual(skill, {
    ok: false,
    problems: [
      {
        file: `/kit/${skillFile}`,
        path: "/author",
        line: 4,
        message: "This file has the field author, which is not allowed here.",
        fix: "Remove author or correct its spelling.",
      },
    ],
  });
});

test("a config key of agentbay 4, such as offline, is refused by name", async () => {
  assert.deepEqual(await problemsWith({ [paths.config]: yamlText({ ...config, offline: true }) }), [
    {
      file: paths.config,
      path: "/offline",
      line: 8,
      message: "This file has the field offline, which is not allowed here.",
      fix: "Remove offline or correct its spelling.",
    },
  ]);
});

test("an interface reference without its major version is refused", async () => {
  assert.deepEqual(messages(await notesProblems({ ...notesMode, requires: { interfaces: ["items-store"] } })), [
    "requires.interfaces.0 is not in the expected form. Expected: An interface name and its major version, " +
      "as name@major, for example items-store@1.",
    notesBindingRefused.message,
  ]);
});

test("an empty file or a list where a mapping belongs is described in a plain sentence", async () => {
  assert.deepEqual(await problemsWith({ [paths.config]: "" }), [
    { file: paths.config, path: "", message: "This file must be a YAML mapping (key: value pairs), but it is empty." },
  ]);
  assert.deepEqual(await problemsWith({ [paths.config]: "- a\n- b\n" }), [
    {
      file: paths.config,
      path: "",
      line: 1,
      message: "This file must be a YAML mapping (key: value pairs), but it is a list.",
    },
  ]);
});

test("a field of the wrong type is named with what it must be and what it is", async () => {
  assert.deepEqual(messages(await notesProblems({ ...notesMode, description: ["a"], actions: [] })), [
    "description must be text, but it is a list.",
    "actions must be a YAML mapping (key: value pairs), but it is a list.",
    notesBindingRefused.message,
  ]);
});

test("limits on lists, text, numbers and constants are described in plain sentences", async () => {
  const mode = {
    ...notesMode,
    description: "",
    implements: ["notes@1", "notes@1"],
    actions: { add: { ...addAction(), run: [], budget: { usd: -1 } } },
  };
  assert.deepEqual(messages(await notesProblems(mode)), [
    "description must not be empty.",
    "implements lists the same entry twice.",
    "actions.add.run must list at least 1 entry, but it lists fewer.",
    "actions.add.budget.usd must be at least 0, but it is -1.",
    notesBindingRefused.message,
  ]);
  const workflow = { name: "daily", trigger: { manual: false }, steps: [{ id: "pause", wait: "1d" }] };
  assert.deepEqual(messages(await problemsWith({ [workflowFile]: yamlText(workflow) })), [
    "trigger.manual must be true, but it is false.",
  ]);
});

test("a key that is not kebab-case is named and placed at the key", async () => {
  const problems = await notesProblems({ ...notesMode, actions: { Add_Note: addAction() } });
  assert.deepEqual(
    problems.map((problem) => [problem.path, problem.message]),
    [
      [
        "/actions/Add_Note",
        "actions has the key Add_Note, which is not in the expected form. Expected: Kebab-case, " +
          "starting with a letter; not constructor, a name every JavaScript object has.",
      ],
      ["/bindings/notes", notesBindingRefused.message],
    ],
  );
});

test("settings are checked against the mode's settings schema under their path, and a schema that cannot be used is named", async () => {
  const settingsSchema = "components/modes/briefing/schemas/settings.json";
  const withoutLookback = yamlText({ ...config, settings: { briefing: {} } });
  assert.deepEqual(await problemsWith({ [paths.config]: withoutLookback }), [
    {
      file: paths.config,
      path: "/settings/briefing",
      line: 6,
      message: "settings.briefing is missing the required field lookback.",
      fix: "Add lookback.",
    },
  ]);
  const unusable = (reason: string): Problem => ({
    file: paths.briefing,
    path: "/settings",
    line: 7,
    message: `Mode briefing names the settings schema schemas/settings.json, which is not a usable JSON Schema: ${reason}.`,
    fix: `Correct ${settingsSchema}.`,
  });
  assert.deepEqual(await problemsWith({ [settingsSchema]: JSON.stringify({ type: "mapping" }) }), [
    unusable(
      "schema is invalid: data/type must be equal to one of the allowed values, " +
        "data/type must be array, data/type must match a schema in anyOf",
    ),
  ]);
  assert.deepEqual(await problemsWith({ [settingsSchema]: JSON.stringify("not a schema") }), [
    unusable("a JSON Schema must be a mapping, true or false"),
  ]);
});
