import assert from "node:assert/strict";
import { test } from "node:test";
import type { Action, Mode } from "../bay/generated/mode.ts";
import { bindingUses, loadSystem, type System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import {
  briefingMode,
  briefingSettingsSchema,
  config,
  itemsStore,
  layout,
  notesMode,
  paths,
  rooted,
  schemaText,
  storeMode,
  validFiles,
  yamlText,
} from "./system-fixture.ts";

function servingModeOf(system: System, caller: string, call: string): string | undefined {
  const answer = system.action(call, caller);
  return answer.ok ? answer.value.mode.manifest.name : undefined;
}

async function systemOf(files: Readonly<Record<string, string>>): Promise<System> {
  const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

async function problemsOf(files: Readonly<Record<string, string>>): Promise<readonly Problem[]> {
  const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
  assert.ok(!outcome.ok, "expected the system to be refused");
  return outcome.problems;
}

function findProblem(problems: readonly Problem[], file: string, words: string): Problem {
  const found = problems.find((problem) => problem.file === file && problem.message.includes(words));
  assert.ok(found, `no problem in ${file} saying "${words}"; got:\n${JSON.stringify(problems, null, 2)}`);
  return found;
}

function withMode(mode: Mode, changes: Partial<Mode>): string {
  return yamlText({ ...mode, ...changes });
}

function without(files: Readonly<Record<string, string>>, ...removed: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !removed.includes(path)));
}

test("a valid three-mode system resolves with every required interface bound", async () => {
  const system = await systemOf(validFiles());
  assert.deepEqual(Array.from(system.modes.keys()).sort(), ["briefing", "notes", "store"]);
  assert.deepEqual(Array.from(system.interfaces.keys()).sort(), ["items-store@1", "notes@1"]);
  assert.deepEqual(bindingUses(system), [
    { interfaceName: "items-store", requirers: ["notes"], servedBy: "store" },
    { interfaceName: "notes", requirers: ["briefing"], servedBy: "notes" },
  ]);
  assert.equal(servingModeOf(system, "notes", "items-store.put"), "store");
  assert.equal(servingModeOf(system, "briefing", "notes.add"), "notes");
  assert.equal(system.config.adapter, "local");
  const notes = system.modes.get("notes");
  assert.ok(notes);
  assert.equal(notes.folder, "/kit/components/modes/notes");
  assert.equal(notes.home, "kit");
  assert.equal(notes.workflows.get("workflows/daily.yaml")?.name, "daily");
  assert.equal(system.interfaces.get("notes@1")?.file, `/kit/${paths.notesInterface}`);
  assert.deepEqual(system.modes.get("briefing")?.settings, { lookback: "3d" });
  assert.deepEqual(system.modes.get("store")?.settings, {});
});

test("a manifest that fails its schema is reported with its line, and checking goes on", async () => {
  const files = { ...validFiles(), [paths.notes]: `${yamlText(notesMode)}colour: blue\n` };
  const problems = await problemsOf(files);
  const problem = findProblem(problems, paths.notes, "has the field colour, which is not allowed here");
  assert.equal(problem.path, "/colour");
  assert.equal(problem.line, yamlText(notesMode).split("\n").length);
  assert.equal(problem.fix, "Remove colour or correct its spelling.");
  assert.ok(!problems.some((problem) => problem.message.includes("which is not a mode")));
});

test("a folder name that differs from the mode's name is reported", async () => {
  const files = {
    ...without(validFiles(), paths.briefing),
    "components/modes/brief/mode.yaml": yamlText(briefingMode),
  };
  const problems = await problemsOf(files);
  const problem = findProblem(
    problems,
    "components/modes/brief/mode.yaml",
    "The mode is named briefing, but its folder is components/modes/brief.",
  );
  assert.equal(problem.fix, "Rename the folder to briefing, or set name: brief.");
  assert.equal(problem.line, 1);
});

test("two modes with the same name are reported", async () => {
  const files = { ...validFiles(), "components/modes/store/mode.yaml": yamlText(storeMode) };
  const problems = await problemsOf(files);
  findProblem(
    problems,
    "components/modes/store/mode.yaml",
    "Two modes are named store: components/base/store/mode.yaml and components/modes/store/mode.yaml.",
  );
});

test("two interface files that define the same name and version are reported", async () => {
  const copy = "components/base/interfaces/stock.yaml";
  const problems = await problemsOf({ ...validFiles(), [copy]: yamlText(itemsStore) });
  findProblem(problems, copy, `Two interface files define items-store@1: ${paths.itemsStore} and ${copy}.`);
});

test("a required interface that no file defines is reported with the versions that exist", async () => {
  const files = {
    ...validFiles(),
    [paths.briefing]: withMode(briefingMode, { requires: { interfaces: ["notes@2"] } }),
  };
  const problem = findProblem(await problemsOf(files), paths.briefing, "Mode briefing requires notes@2");
  assert.match(problem.message, /no interface file in components\/base\/interfaces defines it \(found: notes@1\)/);
  assert.equal(problem.path, "/requires/interfaces/0");
});

test("a required interface that is not bound is reported with the modes that could serve it", async () => {
  const files = { ...validFiles(), [paths.config]: yamlText({ ...config, bindings: { "items-store": "store" } }) };
  const problem = findProblem(
    await problemsOf(files),
    paths.config,
    "Mode briefing requires notes@1, but bindings names no mode for notes.",
  );
  assert.equal(problem.fix, "Add notes: <mode> under bindings; modes that implement notes@1: notes.");
});

test("a binding to a mode that does not exist is reported", async () => {
  const bindings = { ...config.bindings, notes: "nobody" };
  const files = { ...validFiles(), [paths.config]: yamlText({ ...config, bindings }) };
  const problem = findProblem(await problemsOf(files), paths.config, "binds notes to nobody, which is not a mode");
  assert.equal(problem.path, "/bindings/notes");
});

test("a binding to a mode that does not implement the interface and major version is reported", async () => {
  const bindings = { ...config.bindings, notes: "store" };
  const files = { ...validFiles(), [paths.config]: yamlText({ ...config, bindings }) };
  const problem = findProblem(
    await problemsOf(files),
    paths.config,
    "bindings binds notes to store, which does not implement notes@1, as mode briefing requires.",
  );
  assert.equal(
    problem.fix,
    "Bind notes to a mode that implements notes@1 (notes), or add notes@1 to the implements of store.",
  );
});

test("a mode that implements an interface that does not exist is reported", async () => {
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { implements: ["items-store@1", "queue@1"] }) };
  const problem = findProblem(await problemsOf(files), paths.store, "Mode store implements queue@1, but no interface");
  assert.equal(problem.path, "/implements/1");
});

test("an implementing mode that lacks an action of its interface is reported", async () => {
  const actions = Object.fromEntries(Object.entries(storeMode.actions).filter(([name]) => name !== "get"));
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { actions }) };
  findProblem(await problemsOf(files), paths.store, "Mode store implements items-store@1 but has no action get.");
});

test("an implementing mode whose input or output schema differs from the interface's is reported", async () => {
  const files = { ...validFiles(), "components/base/store/schemas/put-input.json": schemaText("something else") };
  const problem = findProblem(
    await problemsOf(files),
    paths.store,
    "Action put of mode store has the input schema schemas/put-input.json, " +
      "which differs from items-store/put-input.json that items-store@1 declares.",
  );
  assert.equal(problem.path, "/actions/put/input");
});

test("an implementing mode that declares effects beyond the interface's is reported", async () => {
  const get = storeMode.actions.get;
  assert.ok(get);
  const actions = { ...storeMode.actions, get: { ...get, effects: ["read", "network"] as const } };
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { actions }) };
  const problem = findProblem(
    await problemsOf(files),
    paths.store,
    "Action get of mode store has the effect network, which items-store@1 does not allow for get.",
  );
  assert.equal(problem.fix, "Remove network from the effects of get; items-store@1 allows: read.");
});

function briefingWithRun(run: Mode["actions"][string]["run"], effects: readonly ("read" | "write")[]): string {
  const digest = briefingMode.actions.digest;
  assert.ok(digest);
  return withMode(briefingMode, { actions: { digest: { ...digest, run, effects } } });
}

test("a call to an interface the mode does not require is reported", async () => {
  const files = {
    ...validFiles(),
    [paths.briefing]: briefingWithRun([{ call: "items-store.get" }], ["read", "write"]),
  };
  const problem = findProblem(
    await problemsOf(files),
    paths.briefing,
    "Action digest of mode briefing calls items-store.get, but mode briefing does not require items-store.",
  );
  assert.equal(problem.fix, "Add items-store@<major> to requires.interfaces of briefing.");
  assert.equal(problem.path, "/actions/digest/run/0/call");
});

test("a call to an action the interface lacks is reported with the actions it has", async () => {
  const files = { ...validFiles(), [paths.briefing]: briefingWithRun([{ call: "notes.remove" }], ["read", "write"]) };
  const problem = findProblem(
    await problemsOf(files),
    paths.briefing,
    "Action digest of mode briefing calls remove of notes@1, which has no such action.",
  );
  assert.equal(problem.fix, "Call one of the actions of notes@1: add.");
});

test("a call whose target has an effect the calling action does not declare is reported", async () => {
  const files = { ...validFiles(), [paths.briefing]: briefingWithRun([{ call: "notes.add" }], ["read"]) };
  const problem = findProblem(
    await problemsOf(files),
    paths.briefing,
    "Action digest of mode briefing calls notes.add, which may have the effect write, but digest does not declare it.",
  );
  assert.equal(problem.fix, "Add write to the effects of digest.");
});

test("an undo that names no action of the same mode is reported", async () => {
  const put = storeMode.actions.put;
  assert.ok(put);
  const actions = { ...storeMode.actions, put: { ...put, undo: "unput" } };
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { actions }) };
  const problem = findProblem(
    await problemsOf(files),
    paths.store,
    "Action put of mode store names undo: unput, but mode store has no action unput.",
  );
  assert.equal(problem.path, "/actions/put/undo");
});

test("referenced schema, script, skill and workflow files that do not exist are all reported", async () => {
  const files = without(
    validFiles(),
    "components/base/store/schemas/get-output.json",
    "components/base/store/scripts/put.ts",
    "components/modes/notes/skills/write-note/SKILL.md",
    "components/modes/notes/workflows/daily.yaml",
    "components/base/interfaces/items-store/get-input.json",
  );
  const problems = await problemsOf(files);
  findProblem(
    problems,
    paths.store,
    "Action get of mode store names the output schema schemas/get-output.json, " +
      "but components/base/store/schemas/get-output.json does not exist.",
  );
  findProblem(problems, paths.store, "Action put of mode store runs the script scripts/put.ts, but");
  findProblem(
    problems,
    paths.notes,
    "Action add of mode notes runs the skill skills/write-note, " +
      "but components/modes/notes/skills/write-note/SKILL.md does not exist.",
  );
  findProblem(problems, paths.notes, "Mode notes lists the workflow workflows/daily.yaml, but");
  findProblem(problems, paths.itemsStore, "Action get of interface items-store@1 names the input schema");
});

test("a referenced schema that is not valid JSON is reported", async () => {
  const files = { ...validFiles(), "components/modes/briefing/schemas/digest-input.json": "{ not json" };
  const problem = findProblem(await problemsOf(files), paths.briefing, "is not valid JSON");
  assert.equal(problem.fix, "Correct the JSON in components/modes/briefing/schemas/digest-input.json.");
});

test("a workflow that fails its schema is reported in the workflow file", async () => {
  const file = "components/modes/notes/workflows/daily.yaml";
  const files = { ...validFiles(), [file]: yamlText({ name: "daily", steps: [{ id: "pause", wait: "soon" }] }) };
  findProblem(await problemsOf(files), file, "steps.0.wait is not in the expected form");
});

test("a dependency cycle between modes through bindings is reported and named", async () => {
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { requires: { interfaces: ["notes@1"] } }) };
  const problems = await problemsOf(files);
  const cycles = problems.filter((problem) => problem.message.includes("cycle"));
  assert.equal(cycles.length, 1);
  const [cycle] = cycles;
  assert.ok(cycle);
  assert.equal(cycle.message, "Modes depend on each other in a cycle through bindings: notes -> store -> notes.");
  assert.equal(cycle.file, paths.config);
});

test("a mode that depends on itself through a binding is reported as a cycle", async () => {
  const selfDependent = withMode(storeMode, { requires: { interfaces: ["items-store@1"] } });
  const onlyStore = without({ ...validFiles(), [paths.store]: selfDependent }, paths.briefing, paths.notes);
  const problems = await problemsOf(onlyStore);
  const cycles = problems.filter((problem) => problem.message.includes("cycle"));
  assert.deepEqual(
    cycles.map((problem) => problem.message),
    ["Modes depend on each other in a cycle through bindings: store -> store."],
  );
});

test("a missing project config is reported with what to put in it", async () => {
  const problems = await problemsOf(without(validFiles(), paths.config));
  const problem = findProblem(problems, paths.config, "The project config agentbay.config.yaml does not exist.");
  assert.equal(problem.fix, "Create it with bindings: (interface name: mode name) and adapter:.");
  assert.equal(problems.length, 1);
});

test("every problem is reported at once, not only the first", async () => {
  const put = storeMode.actions.put;
  assert.ok(put);
  const files = {
    ...without(validFiles(), "components/modes/briefing/scripts/select.ts"),
    [paths.store]: withMode(storeMode, { actions: { ...storeMode.actions, put: { ...put, undo: "unput" } } }),
    [paths.config]: yamlText({ ...config, bindings: { "items-store": "store" } }),
  };
  const problems = await problemsOf(files);
  findProblem(problems, paths.store, "names undo: unput");
  findProblem(problems, paths.briefing, "runs the script scripts/select.ts, but");
  findProblem(problems, paths.config, "bindings names no mode for notes");
});

const workflowFile = "components/modes/notes/workflows/daily.yaml";

function withWorkflowSteps(steps: readonly unknown[]): Record<string, string> {
  return { ...validFiles(), [workflowFile]: yamlText({ name: "daily", steps }) };
}

test("workflow step ids must be unique in the whole file, inside foreach steps too", async () => {
  const files = withWorkflowSteps([
    { id: "write", action: "add" },
    { id: "each", foreach: "$trigger", steps: [{ id: "write", action: "add" }] },
  ]);
  const problem = findProblem(
    await problemsOf(files),
    workflowFile,
    "Workflow workflows/daily.yaml of mode notes has more than one step with the id write.",
  );
  assert.equal(problem.path, "/steps/1/steps/0/id");
  assert.equal(problem.fix, "Give every step its own id; ids are unique in the whole file, inside foreach steps too.");
});

test("a workflow step without an id is refused", async () => {
  const problems = await problemsOf(withWorkflowSteps([{ action: "add" }]));
  findProblem(problems, workflowFile, "steps.0 is missing the required field id.");
});

test("a workflow action step naming an action that does not exist lists the valid names", async () => {
  const problems = await problemsOf(withWorkflowSteps([{ id: "write", action: "publish" }]));
  findProblem(
    problems,
    workflowFile,
    "Step write of workflow workflows/daily.yaml of mode notes names the action publish, which is neither " +
      "an action of mode notes nor an action of an interface it requires. " +
      "Valid names: add, items-store.put, items-store.get.",
  );
  const missing = await problemsOf(withWorkflowSteps([{ id: "write", action: "items-store.erase" }]));
  findProblem(missing, workflowFile, "names the action items-store.erase, which is neither");
});

test("a workflow step calling an interface the mode does not require is reported", async () => {
  const problem = findProblem(
    await problemsOf(withWorkflowSteps([{ id: "brief", action: "notes.add" }])),
    workflowFile,
    "Step brief of workflow workflows/daily.yaml of mode notes names notes.add, but mode notes does not require notes.",
  );
  assert.equal(problem.path, "/steps/0/action");
});

test("an undo that names its own action is reported", async () => {
  const put = storeMode.actions.put;
  assert.ok(put);
  const actions = { ...storeMode.actions, put: { ...put, undo: "put" } };
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { actions }) };
  findProblem(await problemsOf(files), paths.store, "Action put of mode store names itself as its undo.");
});

test("two actions that name each other as undo are reported once", async () => {
  const remove = storeMode.actions.remove;
  assert.ok(remove);
  const actions = { ...storeMode.actions, remove: { ...remove, undo: "put" } };
  const files = { ...validFiles(), [paths.store]: withMode(storeMode, { actions }) };
  const problems = await problemsOf(files);
  const loops = problems.filter((problem) => problem.message.includes("each name the other as undo"));
  assert.equal(loops.length, 1);
  assert.equal(loops[0]?.message, "Actions put and remove of mode store each name the other as undo.");
});

test("the reserved name constructor is refused for modes, actions, step ids, calls and bindings", async () => {
  const add = notesMode.actions.add;
  assert.ok(add);
  const constructorAction = withMode(notesMode, { actions: { ...notesMode.actions, constructor: add } });
  const constructorCall = withMode(notesMode, {
    actions: { add: { ...add, run: [{ call: "items-store.constructor" }] } },
  });
  const cases: readonly (readonly [string, string, string])[] = [
    [paths.store, withMode(storeMode, { name: "constructor" }), "name is not in the expected form"],
    [paths.notes, constructorAction, "actions has the key constructor, which is not in the expected form"],
    [paths.notes, constructorCall, "actions.add.run.0.call is not in the expected form"],
    [workflowFile, yamlText({ name: "daily", steps: [{ id: "constructor", action: "add" }] }), "steps.0.id"],
    [
      paths.config,
      yamlText({ ...config, bindings: { ...config.bindings, constructor: "store" } }),
      "bindings has the key constructor",
    ],
  ];
  for (const [file, text, words] of cases) {
    findProblem(await problemsOf({ ...validFiles(), [file]: text }), file, words);
  }
});

test("a YAML key __proto__ is refused as an action name rather than read as the prototype", async () => {
  const text = yamlText(storeMode).replace("actions:\n", "actions:\n  __proto__:\n    input: x.json\n");
  findProblem(await problemsOf({ ...validFiles(), [paths.store]: text }), paths.store, "actions has the key __proto__");
});

test("a mode that fails to load is not also reported as missing from its binding", async () => {
  const files = { ...validFiles(), [paths.store]: "name: store\nactions: [\n" };
  const problems = await problemsOf(files);
  findProblem(problems, paths.store, "The YAML cannot be read");
  assert.ok(!problems.some((problem) => problem.message.includes("which is not a mode")), JSON.stringify(problems));
  assert.ok(!problems.some((problem) => problem.fix?.includes("none yet") === true), JSON.stringify(problems));
});

test("a mode.yaml in the interfaces folder is reported once, plainly", async () => {
  const misplaced = "components/base/interfaces/mode.yaml";
  const problems = await problemsOf({ ...validFiles(), [misplaced]: yamlText(storeMode) });
  assert.deepEqual(problems, [
    {
      file: misplaced,
      path: "",
      message: "components/base/interfaces holds interface files only, but it has a mode.yaml.",
      fix: "Move the mode to a folder of its own, such as components/modes/<mode>/mode.yaml.",
    },
  ]);
});

const settingsSchemaFile = "components/modes/briefing/schemas/settings.json";

test("settings that break the mode's settings schema are reported in the project config", async () => {
  const files = { ...validFiles(), [paths.config]: yamlText({ ...config, settings: { briefing: { lookback: 3 } } }) };
  const problem = findProblem(
    await problemsOf(files),
    paths.config,
    "settings.briefing.lookback must be text, but it is 3.",
  );
  assert.equal(problem.path, "/settings/briefing/lookback");
  assert.equal(problem.line, yamlText({ ...config, settings: { briefing: { lookback: 3 } } }).split("\n").length - 1);
});

test("a mode with a settings schema and no settings entry is checked against an empty mapping", async () => {
  const withoutSettings = { bindings: config.bindings, adapter: config.adapter };
  const files = { ...validFiles(), [paths.config]: yamlText(withoutSettings) };
  const problem = findProblem(
    await problemsOf(files),
    paths.config,
    "settings.briefing is missing the required field lookback.",
  );
  assert.equal(problem.fix, "Add lookback.");
});

test("settings for a mode that declares no settings schema, or for no mode, are reported", async () => {
  const settings = { ...config.settings, store: { size: 1 }, ghost: {} };
  const problems = await problemsOf({ ...validFiles(), [paths.config]: yamlText({ ...config, settings }) });
  findProblem(problems, paths.config, "settings gives settings for mode store, which declares no settings schema.");
  findProblem(problems, paths.config, "settings gives settings for ghost, which is not a mode.");
});

test("a settings schema that is missing or not usable is reported in the mode's manifest", async () => {
  const missing = await problemsOf(without(validFiles(), settingsSchemaFile));
  findProblem(missing, paths.briefing, "Mode briefing names the settings schema schemas/settings.json, but");
  const unusable = { ...briefingSettingsSchema, type: "mapping" };
  const problems = await problemsOf({ ...validFiles(), [settingsSchemaFile]: JSON.stringify(unusable) });
  findProblem(problems, paths.briefing, "which is not a usable JSON Schema");
});

test("a skill step's check script that does not exist is reported", async () => {
  const add: Action = {
    description: "When the owner wants a note written.",
    input: "schemas/add-input.json",
    output: "schemas/add-output.json",
    effects: ["read", "write"],
    run: [{ skill: "skills/write-note", tier: "fast", checks: ["scripts/length.ts"] }, { call: "items-store.put" }],
  };
  const actions = { add };
  const files = { ...validFiles(), [paths.notes]: withMode(notesMode, { actions }) };
  const problem = findProblem(
    await problemsOf(files),
    paths.notes,
    "checks its skill step with the script scripts/length.ts, but components/modes/notes/scripts/length.ts",
  );
  assert.equal(problem.path, "/actions/add/run/0/checks/0");
  await systemOf({ ...files, "components/modes/notes/scripts/length.ts": "" });
  const second: Action = {
    ...add,
    run: [
      { call: "items-store.put" },
      { skill: "skills/write-note", tier: "fast", checks: ["scripts/length.ts", "scripts/fit.ts"] },
    ],
  };
  const secondFiles = {
    ...files,
    [paths.notes]: withMode(notesMode, { actions: { add: second } }),
    "components/modes/notes/scripts/fit.ts": "",
  };
  const placed = findProblem(
    await problemsOf(secondFiles),
    paths.notes,
    "checks its skill step with the script scripts/length.ts",
  );
  assert.equal(placed.path, "/actions/add/run/1/checks/0");
});

test("well-formed workflow references to earlier steps, the trigger, the item and settings are accepted", async () => {
  const files = withWorkflowSteps([
    { id: "write", action: "add", input: { text: "$trigger", tag: "literal", count: 3 } },
    { id: "check", action: "items-store.get", input: { id: "$steps.write.output.id", lookback: "$settings.lookback" } },
    {
      id: "each",
      foreach: "$steps.check.output.items",
      steps: [
        { id: "again", action: "add", input: { text: "$item", first: "$steps.write.output" } },
        { id: "look", approval: "Fine?", show: "$steps.again.output" },
      ],
    },
    { id: "keep", approval: "Keep it?", show: "$steps.each.output" },
  ]);
  await systemOf(files);
});

test("a malformed workflow reference is reported with the grammar", async () => {
  const files = withWorkflowSteps([
    { id: "write", action: "add", input: { text: "$trigger.text", price: "$5" } },
    { id: "keep", approval: "Keep it?", show: "$steps.write" },
  ]);
  const problems = await problemsOf(files);
  for (const [path, text] of [
    ["/steps/0/input/text", "$trigger.text"],
    ["/steps/0/input/price", "$5"],
    ["/steps/1/show", "$steps.write"],
  ] as const) {
    const problem = findProblem(problems, workflowFile, `${text} is not a reference`);
    assert.ok(problems.some((candidate) => candidate.path === path && candidate.message.includes(`${text} is not`)));
    assert.match(problem.fix ?? "", /\$steps\.<id>\.output/);
  }
});

test("a reference to a step that is not defined earlier in its scope is reported", async () => {
  const files = withWorkflowSteps([
    { id: "write", action: "add", input: { text: "$steps.keep.output" } },
    { id: "each", foreach: "$trigger", steps: [{ id: "inner", action: "add" }] },
    { id: "keep", approval: "Keep it?", show: "$steps.inner.output" },
    { id: "self", action: "add", input: { text: "$steps.self.output" } },
  ]);
  const problems = await problemsOf(files);
  const later = findProblem(problems, workflowFile, "$steps.keep.output names the step keep");
  assert.equal(later.path, "/steps/0/input/text");
  assert.match(later.message, /earlier steps: none/);
  const nested = findProblem(problems, workflowFile, "$steps.inner.output names the step inner");
  assert.match(nested.message, /earlier steps: write, each\)/);
  findProblem(problems, workflowFile, "$steps.self.output names the step self");
});

test("$item outside a foreach is reported, and inside one it is accepted", async () => {
  const problems = await problemsOf(
    withWorkflowSteps([
      { id: "write", action: "add", input: { text: "$item" } },
      { id: "each", foreach: "$item", steps: [{ id: "inner", action: "add", input: { text: "$item" } }] },
    ]),
  );
  const outside = problems.filter((problem) => problem.message.includes("$item is used outside a foreach"));
  assert.deepEqual(
    outside.map((problem) => problem.path),
    ["/steps/0/input/text", "/steps/1/foreach"],
  );
});

test("workflow reference issues name the path of each bad reference", async () => {
  const problems = await problemsOf(
    withWorkflowSteps([
      { id: "a", action: "add", input: { v: "$steps.b.output" } },
      { id: "b", foreach: "$steps.a.output", steps: [{ id: "c", approval: "ok?", show: "$item" }] },
      { id: "d", wait: "1h" },
      { id: "e", approval: "ok?", show: "$item" },
    ]),
  );
  assert.deepEqual(
    problems.map((problem) => [problem.file, problem.path]),
    [
      [workflowFile, "/steps/0/input/v"],
      [workflowFile, "/steps/3/show"],
    ],
  );
});

test("a when condition on a workflow step is refused; steps have no conditions", async () => {
  const problems = await problemsOf(withWorkflowSteps([{ id: "keep", approval: "Keep it?", when: "$trigger" }]));
  findProblem(problems, workflowFile, "steps.0 has the field when, which is not allowed here.");
});
