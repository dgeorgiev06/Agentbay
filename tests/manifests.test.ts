import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  loadSystemReport,
  type ActionTarget,
  type ActiveMode,
  type ActionsListing,
  type System,
  type WorkflowTarget,
} from "../bay/manifests/manifests.ts";
import { fakeFileSystem } from "./fakes.ts";
import {
  briefingMode,
  config,
  layout,
  paths,
  rooted,
  schemaText,
  separateLayout,
  validFiles,
  yamlText,
} from "./system-fixture.ts";

const shelfMode = {
  name: "shelf",
  version: "1.0.0",
  description: "Keeps items on a shelf.",
  implements: ["items-store@1"],
  actions: {
    put: {
      description: "When a mode shelves an item.",
      input: "schemas/put-input.json",
      output: "schemas/put-output.json",
      effects: ["write"],
      run: [{ script: "scripts/put.ts" }],
    },
    get: {
      description: "When a mode takes an item off the shelf.",
      input: "schemas/get-input.json",
      output: "schemas/get-output.json",
      effects: ["read"],
      run: [{ script: "scripts/get.ts" }],
    },
  },
};

const journalMode = {
  name: "journal",
  version: "1.0.0",
  description: "Keeps a journal on the shelf.",
  requires: { interfaces: ["items-store@1"] },
  actions: {
    write: {
      description: "When the owner writes an entry.",
      input: "schemas/write-input.json",
      output: "schemas/write-output.json",
      effects: ["read", "write"],
      run: [{ call: "items-store.put" }],
    },
  },
};

function projectMode(mode: { readonly name: string }, files: readonly string[]): Record<string, string> {
  const folder = `/project/components/modes/${mode.name}`;
  const schemas = files.filter((file) => file.endsWith(".json"));
  const scripts = files.filter((file) => file.endsWith(".ts"));
  return {
    [`${folder}/mode.yaml`]: yamlText(mode),
    ...Object.fromEntries(schemas.map((file) => [`${folder}/schemas/${file}`, schemaText(file.slice(0, -5))])),
    ...Object.fromEntries(scripts.map((file) => [`${folder}/scripts/${file}`, ""])),
  };
}

function projectFiles(): Record<string, string> {
  const kit = Object.entries(validFiles()).filter(([path]) => path !== paths.config);
  const bindings = { "items-store": { notes: "store", journal: "shelf" }, notes: "notes" };
  return {
    ...Object.fromEntries(kit.map(([path, text]) => [`/kit/${path}`, text])),
    "/project/agentbay.config.yaml": yamlText({ ...config, bindings, modes: ["notes"], settings: {} }),
    ...projectMode(shelfMode, ["put-input.json", "put-output.json", "get-input.json", "get-output.json", "put.ts"]),
    ...projectMode(journalMode, ["write-input.json", "write-output.json"]),
    "/project/components/modes/shelf/scripts/get.ts": "",
  };
}

async function projectSystem(): Promise<System> {
  const outcome = (await loadSystemReport(fakeFileSystem(projectFiles()), separateLayout)).outcome;
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

function reached(answer: ReturnType<System["action"]>): readonly string[] {
  assert.ok(answer.ok, answer.ok ? "" : JSON.stringify(answer.problems));
  const caller = answer.value.caller === undefined ? [] : [`through ${answer.value.caller}`];
  return [answer.value.mode.manifest.name, answer.value.name, answer.value.action.description, ...caller];
}

type Answer = { readonly ok: true } | { readonly ok: false; readonly problems: readonly unknown[] };

function refusal(answer: Answer): readonly unknown[] {
  assert.ok(!answer.ok, `expected a refusal, got ${JSON.stringify(answer)}`);
  return answer.problems;
}

const notActive = {
  file: "",
  path: "",
  message: "Mode briefing is not active in this project, so nothing of it runs here.",
  fix: "Add briefing to modes: in agentbay.config.yaml, or bind an interface it implements.",
};

function sentence(message: string): { readonly file: ""; readonly path: ""; readonly message: string } {
  return { file: "", path: "", message };
}

describe("system.action", () => {
  test("mode.action names an action directly", async () => {
    const system = await projectSystem();
    assert.deepEqual(reached(system.action("notes.add")), ["notes", "add", "When the owner wants a note written."]);
    assert.deepEqual(reached(system.action("shelf.put")), ["shelf", "put", "When a mode shelves an item."]);
  });

  test("with a caller, a bare name is the caller's own action", async () => {
    const system = await projectSystem();
    assert.deepEqual(reached(system.action("write", "journal")), [
      "journal",
      "write",
      "When the owner writes an entry.",
    ]);
    assert.deepEqual(reached(system.action("add", "notes")), ["notes", "add", "When the owner wants a note written."]);
  });

  test("with a caller, interface.action follows that caller's own binding", async () => {
    const system = await projectSystem();
    assert.deepEqual(reached(system.action("items-store.put", "journal")), [
      "shelf",
      "put",
      "When a mode shelves an item.",
      "through journal",
    ]);
    assert.deepEqual(reached(system.action("items-store.put", "notes")), [
      "store",
      "put",
      "When a mode keeps an item.",
      "through notes",
    ]);
  });

  test("a mode that does not exist is refused", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("ghost.add")), [sentence("There is no mode ghost.")]);
    assert.deepEqual(refusal(system.action("add", "ghost")), [sentence("There is no mode ghost.")]);
  });

  test("a mode that is not active is refused, as the one asked for and as the caller", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("briefing.digest")), [notActive]);
    assert.deepEqual(refusal(system.action("digest", "briefing")), [notActive]);
    assert.deepEqual(refusal(system.action("notes.add", "briefing")), [notActive]);
  });

  test("an action that does not exist is refused with the actions the mode has", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("notes.nothing")), [
      sentence("Mode notes has no action nothing; it has: add."),
    ]);
    assert.deepEqual(refusal(system.action("notes.constructor")), [
      sentence("Mode notes has no action constructor; it has: add."),
    ]);
  });

  test("a bare name never reaches another mode's action", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("write", "notes")), [
      sentence("Mode notes has no action write; it has: add."),
    ]);
    assert.deepEqual(refusal(system.action("put", "journal")), [
      sentence("Mode journal has no action put; it has: write."),
    ]);
  });

  test("an interface the caller does not require is refused", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("notes.add", "journal")), [
      sentence("Mode journal calls notes.add, but it does not require the interface notes."),
    ]);
    assert.deepEqual(refusal(system.action("items-store.put", "shelf")), [
      sentence("Mode shelf calls items-store.put, but it does not require the interface items-store."),
    ]);
  });

  test("an interface that is not bound for the caller is refused", async () => {
    const system = await projectSystem();
    const unbound = { ...system, config: { ...system.config, bindings: { "items-store": { journal: "shelf" } } } };
    assert.deepEqual(refusal(unbound.action("items-store.put", "notes")), [
      sentence("Mode notes calls items-store.put, but no mode is bound to items-store@1 for it."),
    ]);
    assert.deepEqual(reached(unbound.action("items-store.put", "journal")).slice(0, 2), ["shelf", "put"]);
  });

  test("without a caller, a name that is not mode.action is refused", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("notes")), [
      sentence("notes does not name an action; write <mode>.<action>."),
    ]);
    assert.deepEqual(refusal(system.action(".add")), [
      sentence(".add does not name an action; write <mode>.<action>."),
    ]);
  });
});

function found(answer: ReturnType<System["workflow"]>): readonly unknown[] {
  assert.ok(answer.ok, answer.ok ? "" : JSON.stringify(answer.problems));
  const { mode, path, workflow } = answer.value;
  return [mode.manifest.name, path, workflow.name, workflow.steps.map((step) => step.id)];
}

describe("system.workflow", () => {
  test("a workflow of an active mode is found with its mode", async () => {
    const system = await projectSystem();
    assert.deepEqual(found(system.workflow("notes", "workflows/daily.yaml")), [
      "notes",
      "workflows/daily.yaml",
      "daily",
      ["write", "check", "keep"],
    ]);
  });

  test("a mode that does not exist is refused", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.workflow("ghost", "workflows/daily.yaml")), [
      sentence("Mode ghost has no workflow workflows/daily.yaml."),
    ]);
  });

  test("a mode that is not active is refused", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.workflow("briefing", "workflows/daily.yaml")), [notActive]);
  });

  test("a workflow file the mode does not list is refused", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.workflow("notes", "workflows/none.yaml")), [
      sentence("Mode notes has no workflow workflows/none.yaml."),
    ]);
    assert.deepEqual(refusal(system.workflow("journal", "workflows/daily.yaml")), [
      sentence("Mode journal has no workflow workflows/daily.yaml."),
    ]);
  });
});

async function loadedSystem(
  files: ReturnType<typeof fakeFileSystem>,
  loadedLayout: typeof layout = layout,
): Promise<System> {
  const outcome = (await loadSystemReport(files, loadedLayout)).outcome;
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

async function kitSystem(): Promise<System> {
  return loadedSystem(fakeFileSystem(rooted(validFiles())));
}

function listed(outcome: ReturnType<System["listing"]>): ActionsListing {
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

function listingRefusal(
  outcome: ReturnType<System["listing"]>,
): Extract<ReturnType<System["listing"]>, { readonly ok: false }>["problems"] {
  assert.ok(!outcome.ok, `expected a problem, got ${JSON.stringify(outcome)}`);
  return outcome.problems;
}

const allModes = {
  modes: [
    { name: "briefing", description: "Writes a daily briefing as a note." },
    { name: "notes", description: "Writes notes into the store." },
    { name: "store", description: "Keeps items." },
  ],
};

function separateProject(): ReturnType<typeof fakeFileSystem> {
  const kit = Object.entries(validFiles()).filter(([path]) => path !== "agentbay.config.yaml");
  const projectConfig = yamlText({ ...config, modes: ["notes"], settings: {} });
  return fakeFileSystem({
    ...Object.fromEntries(kit.map(([path, text]) => [`/kit/${path}`, text])),
    "/project/agentbay.config.yaml": projectConfig,
  });
}

describe("system.listing", () => {
  test("asked with nothing, the listing gives each active mode's name and description, by name", async () => {
    assert.deepEqual(listed((await kitSystem()).listing({})), allModes);
  });

  test("asked with a mode, the listing gives its actions as mode.action, with description, effects and input schema", async () => {
    assert.deepEqual(listed((await kitSystem()).listing({ mode: "store" })), {
      mode: "store",
      actions: [
        {
          name: "store.put",
          description: "When a mode keeps an item.",
          effects: ["write"],
          input: { title: "put-input", type: "object" },
        },
        {
          name: "store.get",
          description: "When a mode reads an item back.",
          effects: ["read"],
          input: { title: "get-input", type: "object" },
        },
        {
          name: "store.remove",
          description: "When a kept item must go.",
          effects: ["delete"],
          input: { title: "put-output", type: "object" },
        },
      ],
    });
  });

  test("an unknown mode gives a problem that names the active modes", async () => {
    assert.deepEqual(listingRefusal((await kitSystem()).listing({ mode: "ledger" })), [
      {
        file: "",
        path: "",
        message: "There is no active mode ledger. The active modes are briefing, notes, store.",
        fix: "Name one of them, or leave the mode out to list them.",
      },
    ]);
  });

  test("a mode that is loaded but not active is neither listed nor answered for", async () => {
    const system = await loadedSystem(separateProject(), separateLayout);
    assert.deepEqual([...system.inactive], ["briefing"]);
    assert.deepEqual(listed(system.listing({})), {
      modes: [
        { name: "notes", description: "Writes notes into the store." },
        { name: "store", description: "Keeps items." },
      ],
    });
    assert.deepEqual(
      listingRefusal(system.listing({ mode: "briefing" })).map((problem) => problem.message),
      ["There is no active mode briefing. The active modes are notes, store."],
    );
  });

  test("find keeps the modes that hold every word in their name or description", async () => {
    const system = await kitSystem();
    assert.deepEqual(listed(system.listing({ find: "writes daily" })), {
      modes: [{ name: "briefing", description: "Writes a daily briefing as a note." }],
    });
    assert.deepEqual(listed(system.listing({ find: "writes note" })), {
      modes: [
        { name: "briefing", description: "Writes a daily briefing as a note." },
        { name: "notes", description: "Writes notes into the store." },
      ],
    });
  });

  test("find ignores case, in the words and in the text", async () => {
    const system = await kitSystem();
    assert.deepEqual(listed(system.listing({ find: "KEEPS Items" })), {
      modes: [{ name: "store", description: "Keeps items." }],
    });
    assert.deepEqual(listed(system.listing({ mode: "store", find: "Reads BACK" })), {
      mode: "store",
      actions: [
        {
          name: "store.get",
          description: "When a mode reads an item back.",
          effects: ["read"],
          input: { title: "get-input", type: "object" },
        },
      ],
    });
  });

  test("find matches an action's name as mode.action", async () => {
    const outcome = listed((await kitSystem()).listing({ mode: "notes", find: "notes.add" }));
    assert.deepEqual(outcome, {
      mode: "notes",
      actions: [
        {
          name: "notes.add",
          description: "When the owner wants a note written.",
          effects: ["read", "write"],
          input: { title: "add-input", type: "object" },
        },
      ],
    });
  });

  test("find with no match gives an empty list, not a problem", async () => {
    const system = await kitSystem();
    assert.deepEqual(listed(system.listing({ find: "zebra" })), { modes: [] });
    assert.deepEqual(listed(system.listing({ mode: "store", find: "item zebra" })), {
      mode: "store",
      actions: [],
    });
  });

  test("the listing is live: a mode folder added to the project is listed on the next load", async () => {
    const files = fakeFileSystem(rooted(validFiles()));
    assert.deepEqual(listed((await loadedSystem(files)).listing({})), allModes);
    const journal = {
      name: "journal",
      version: "1.0.0",
      description: "Keeps a journal.",
      actions: {
        write: {
          description: "When the owner writes an entry.",
          input: "schemas/in.json",
          output: "schemas/out.json",
          effects: ["write"],
          run: [{ script: "scripts/write.ts" }],
        },
      },
    };
    await files.writeAtomic("/kit/components/modes/journal/mode.yaml", yamlText(journal));
    await files.writeAtomic("/kit/components/modes/journal/schemas/in.json", schemaText("in"));
    await files.writeAtomic("/kit/components/modes/journal/schemas/out.json", schemaText("out"));
    await files.writeAtomic("/kit/components/modes/journal/scripts/write.ts", "");
    const again = await loadedSystem(files);
    assert.deepEqual(listed(again.listing({})), {
      modes: [
        { name: "briefing", description: "Writes a daily briefing as a note." },
        { name: "journal", description: "Keeps a journal." },
        { name: "notes", description: "Writes notes into the store." },
        { name: "store", description: "Keeps items." },
      ],
    });
    assert.deepEqual(listed(again.listing({ mode: "journal" })), {
      mode: "journal",
      actions: [
        {
          name: "journal.write",
          description: "When the owner writes an entry.",
          effects: ["write"],
          input: { title: "in", type: "object" },
        },
      ],
    });
  });

  test("an action whose input schema could not be read gives a problem instead of a listing without it", async () => {
    const system = await kitSystem();
    const store = system.modes.get("store");
    assert.ok(store);
    const withoutSchemas = { ...store, inputSchemas: new Map() };
    const changed = { ...system, modes: new Map([...system.modes, ["store", withoutSchemas]]) };
    assert.deepEqual(listingRefusal(changed.listing({ mode: "store" })), [
      { file: "", path: "", message: "The input schema of store.put could not be read.", fix: "Run bay check." },
      { file: "", path: "", message: "The input schema of store.get could not be read.", fix: "Run bay check." },
      { file: "", path: "", message: "The input schema of store.remove could not be read.", fix: "Run bay check." },
    ]);
  });
});

async function briefingDigest(files: Readonly<Record<string, string>> = validFiles()): Promise<ActionTarget> {
  const system = await loadedSystem(fakeFileSystem(rooted(files)));
  const target = system.action("briefing.digest");
  assert.ok(target.ok, target.ok ? "" : JSON.stringify(target.problems));
  return target.value;
}

const digestInput = "/kit/components/modes/briefing/schemas/digest-input.json";

const digestOutput = "/kit/components/modes/briefing/schemas/digest-output.json";

describe("an action target's schemas", () => {
  test("a value that fits the input or output schema comes back", async () => {
    const target = await briefingDigest();
    assert.deepEqual(target.input.check({ title: "Tea" }), { ok: true, value: { title: "Tea" } });
    assert.deepEqual(target.output.check({ id: 1 }), { ok: true, value: { id: 1 } });
  });

  test("a value that does not fit gives the problem at /input or /output, in the schema file", async () => {
    const target = await briefingDigest();
    assert.deepEqual(target.input.check(42), {
      ok: false,
      problems: [
        {
          file: digestInput,
          path: "/input",
          message: "input must be a YAML mapping (key: value pairs), but it is 42.",
        },
      ],
    });
    assert.deepEqual(target.output.check(["a"]), {
      ok: false,
      problems: [
        {
          file: digestOutput,
          path: "/output",
          message: "output must be a YAML mapping (key: value pairs), but it is a list.",
        },
      ],
    });
  });

  test("the input is checked against the input schema and the output against the output schema", async () => {
    const files = {
      ...validFiles(),
      "components/modes/briefing/schemas/digest-input.json": JSON.stringify({ type: "object", required: ["title"] }),
      "components/modes/briefing/schemas/digest-output.json": JSON.stringify({ type: "object", required: ["id"] }),
    };
    const target = await briefingDigest(files);
    assert.deepEqual(target.input.check({ id: 1 }), {
      ok: false,
      problems: [
        {
          file: digestInput,
          path: "/input",
          message: "input is missing the required field title.",
          fix: "Add title.",
        },
      ],
    });
    assert.deepEqual(target.output.check({ title: "Tea" }), {
      ok: false,
      problems: [
        { file: digestOutput, path: "/output", message: "output is missing the required field id.", fix: "Add id." },
      ],
    });
  });

  test("a schema file that is not a usable schema gives a problem, not an exception", async () => {
    const files = { ...validFiles(), "components/modes/briefing/schemas/digest-input.json": '{ "type": "mapping" }' };
    const target = await briefingDigest(files);
    assert.deepEqual(target.input.check({}), {
      ok: false,
      problems: [
        {
          file: digestInput,
          path: "",
          message:
            `The schema file ${digestInput} is not a usable JSON Schema: ` +
            "schema is invalid: data/type must be equal to one of the allowed values, " +
            "data/type must be array, data/type must match a schema in anyOf.",
        },
      ],
    });
  });

  test("a schema file that is missing or not JSON stops the load with a problem, not an exception", async () => {
    const missing = Object.fromEntries(
      Object.entries(validFiles()).filter(([path]) => path !== "components/modes/briefing/schemas/digest-input.json"),
    );
    const notJson = { ...validFiles(), "components/modes/briefing/schemas/digest-input.json": "{ not json" };
    for (const files of [missing, notJson]) {
      const outcome = (await loadSystemReport(fakeFileSystem(rooted(files)), layout)).outcome;
      assert.ok(!outcome.ok);
      assert.deepEqual(
        outcome.problems.map((problem) => [problem.file, problem.path, problem.message.split(", but ")[0]]),
        [
          [
            paths.briefing,
            "/actions/digest/input",
            "Action digest of mode briefing names the input schema schemas/digest-input.json",
          ],
        ],
      );
    }
  });
});

function briefingWithWorkflow(): Record<string, string> {
  const briefing = { ...briefingMode, workflows: ["workflows/morning.yaml"] };
  const morning = { name: "morning", trigger: { manual: true }, steps: [{ id: "write", action: "digest" }] };
  return {
    ...validFiles(),
    [paths.briefing]: yamlText(briefing),
    "components/modes/briefing/workflows/morning.yaml": yamlText(morning),
  };
}

async function workflowTarget(mode: string, path: string): Promise<WorkflowTarget> {
  const system = await loadedSystem(fakeFileSystem(rooted(briefingWithWorkflow())));
  const target = system.workflow(mode, path);
  assert.ok(target.ok, target.ok ? "" : JSON.stringify(target.problems));
  return target.value;
}

const written = { items: [{ id: "a" }, { id: "b" }] };

const afterWrite = { trigger: { topic: "tea" }, outputs: new Map([["write", written]]) };

describe("a workflow target's resolve", () => {
  test("$trigger resolves to the trigger", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("$trigger", afterWrite), { ok: true, value: { topic: "tea" } });
  });

  test("$steps.<id>.output resolves to that step's output, along a dotted path", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("$steps.write.output", afterWrite), { ok: true, value: written });
    assert.deepEqual(target.resolve("$steps.write.output.items.1", afterWrite), { ok: true, value: { id: "b" } });
  });

  test("$item resolves to the item of the foreach, and to nothing outside one", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("$item", { ...afterWrite, item: { id: "a" } }), { ok: true, value: { id: "a" } });
    assert.deepEqual(target.resolve("$item", afterWrite), {
      ok: false,
      problems: [sentence("$item resolves to nothing: it is used outside a foreach.")],
    });
  });

  test("$settings.<key> resolves to a setting of the workflow's own mode", async () => {
    const briefing = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(briefing.resolve("$settings.lookback", afterWrite), { ok: true, value: "3d" });
    assert.deepEqual(briefing.resolve("$settings.size", afterWrite), {
      ok: false,
      problems: [
        sentence("$settings.size resolves to nothing: the mode's settings have no size (available: lookback)."),
      ],
    });
    const notes = await workflowTarget("notes", "workflows/daily.yaml");
    assert.deepEqual(notes.resolve("$settings.lookback", afterWrite), {
      ok: false,
      problems: [
        sentence("$settings.lookback resolves to nothing: the mode's settings have no lookback (available: none)."),
      ],
    });
  });

  test("a value with no reference comes back as it is, and a mapping resolves each field", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("plain words", afterWrite), { ok: true, value: "plain words" });
    assert.deepEqual(
      target.resolve({ limit: 5, topic: "$trigger", first: "$steps.write.output.items.0" }, afterWrite),
      {
        ok: true,
        value: { limit: 5, topic: { topic: "tea" }, first: { id: "a" } },
      },
    );
  });

  test("a reference to a step that has no output yet resolves to nothing", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("$steps.later.output", afterWrite), {
      ok: false,
      problems: [
        sentence("$steps.later.output resolves to nothing: no step later has finished before it (available: write)."),
      ],
    });
    assert.deepEqual(target.resolve({ topic: "$steps.later.output" }, afterWrite), {
      ok: false,
      problems: [
        sentence(
          "input.topic: $steps.later.output resolves to nothing: no step later has finished before it (available: write).",
        ),
      ],
    });
  });

  test("a reference that names nothing gives the grammar, and a path that leads nowhere says what is there", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("$nothing", afterWrite), {
      ok: false,
      problems: [
        sentence(
          "$nothing is not a reference: write $trigger, $item, $settings.<key> or $steps.<id>.output with an optional " +
            "dotted path such as .items.0. Every value that starts with $ is read as a reference.",
        ),
      ],
    });
    assert.deepEqual(target.resolve("$steps.write.output.count", afterWrite), {
      ok: false,
      problems: [
        sentence(
          "$steps.write.output.count resolves to nothing: output of step write has no count; " +
            "it is a mapping with the keys items.",
        ),
      ],
    });
  });
});

const draftSkill = [
  "---",
  "name: write-note",
  "description: Writes one note from the input.",
  "metadata:",
  "  output: schemas/note-draft.json",
  "---",
  "",
  "## Input",
  "",
  "- db",
  "",
  "## Tools",
  "",
  "1. `files`: to read the drafts",
  "- items-store.get",
  "- http,",
  "```",
  "- db",
  "```",
  "",
  "## Resources",
  "",
  "- secrets",
  "",
].join("\n");

const skillFile = "/kit/components/modes/notes/skills/write-note/SKILL.md";

const noteDraft = "/kit/components/modes/notes/schemas/note-draft.json";

function filesWithSkill(text: string): ReturnType<typeof fakeFileSystem> {
  return fakeFileSystem(
    rooted({
      ...validFiles(),
      "components/modes/notes/skills/write-note/SKILL.md": text,
      "components/modes/notes/schemas/note-draft.json": JSON.stringify({ type: "object", required: ["text"] }),
    }),
  );
}

async function notesMode(files: ReturnType<typeof fakeFileSystem>): Promise<ActiveMode> {
  const mode = (await loadedSystem(files)).modes.get("notes");
  assert.ok(mode);
  return mode;
}

describe("a mode's skill by name", () => {
  test("a skill is found with its file, front matter, tools and output schema", async () => {
    const skill = await (await notesMode(filesWithSkill(draftSkill))).skill("skills/write-note");
    assert.ok(skill.ok, skill.ok ? "" : JSON.stringify(skill.problems));
    const { name, file, frontMatter, tools, output } = skill.value;
    assert.deepEqual([name, file, tools], ["skills/write-note", skillFile, ["files", "items-store.get", "http"]]);
    assert.deepEqual(frontMatter, {
      name: "write-note",
      description: "Writes one note from the input.",
      metadata: { output: "schemas/note-draft.json" },
    });
    assert.ok(output);
    assert.equal(output.file, noteDraft);
    assert.deepEqual(output.check({ text: "Tea" }), { ok: true, value: { text: "Tea" } });
    assert.deepEqual(output.check({}), {
      ok: false,
      problems: [
        { file: noteDraft, path: "/output", message: "output is missing the required field text.", fix: "Add text." },
      ],
    });
  });

  test("a skill whose front matter names no output schema has none, and a Tools section it lacks lists nothing", async () => {
    const skill = await (await notesMode(fakeFileSystem(rooted(validFiles())))).skill("skills/write-note");
    assert.ok(skill.ok, skill.ok ? "" : JSON.stringify(skill.problems));
    assert.deepEqual([skill.value.output, skill.value.tools], [undefined, []]);
  });

  test("an output schema file that is missing gives a problem when a value is checked", async () => {
    const files = filesWithSkill(draftSkill.replace("note-draft.json", "gone.json"));
    const skill = await (await notesMode(files)).skill("skills/write-note");
    assert.ok(skill.ok);
    const gone = "/kit/components/modes/notes/schemas/gone.json";
    assert.deepEqual(skill.value.output?.check({ text: "Tea" }), {
      ok: false,
      problems: [
        { file: gone, path: "", message: `The schema file ${gone} does not exist, so the output is not checked.` },
      ],
    });
  });

  test("a skill the mode's steps do not run is not found", async () => {
    const mode = await notesMode(filesWithSkill(draftSkill));
    assert.deepEqual(refusal(await mode.skill("skills/none")), [sentence("Mode notes has no skill skills/none.")]);
    assert.deepEqual(refusal(await mode.skill("write-note")), [sentence("Mode notes has no skill write-note.")]);
  });

  test("a skill file that cannot be read gives its problems", async () => {
    const files = filesWithSkill("# Draft\n");
    const mode = await notesMode(files);
    assert.deepEqual(refusal(await mode.skill("skills/write-note")), [
      {
        file: skillFile,
        path: "",
        line: 1,
        message: "The skill has no front matter between two --- lines at its top.",
        fix: "Start the file with a --- line, then name: and description:, then another --- line.",
      },
    ]);
    await files.removal.remove(skillFile);
    assert.deepEqual(refusal(await mode.skill("skills/write-note")), [
      { file: skillFile, path: "", message: `The file ${skillFile} does not exist.` },
    ]);
  });
});
