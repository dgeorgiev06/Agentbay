import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  inspectSystem,
  loadSystem,
  placeToWrite,
  type ActionTarget,
  type ActionsListing,
  type ActiveMode,
  type InspectedFolder,
  type Inspection,
  type NewPart,
  type System,
  type WorkflowTarget,
} from "../bay/manifests/manifests.ts";
import type { Json } from "../bay/contracts.ts";
import { fakeFileSystem } from "./fakes.ts";
import {
  briefingMode,
  config,
  notesMode as notesManifest,
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
  const outcome = await loadSystem(fakeFileSystem(projectFiles()), separateLayout);
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

  test("a mode name is matched exactly", async () => {
    const system = await projectSystem();
    assert.deepEqual(refusal(system.action("Store.put")), [sentence("There is no mode Store.")]);
    assert.deepEqual(refusal(system.action("STORE.put")), [sentence("There is no mode STORE.")]);
    assert.deepEqual(refusal(system.action("put", "Store")), [sentence("There is no mode Store.")]);
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

  test("an interface that is not bound for the caller cannot be loaded, so it is never asked", async () => {
    const bindings = { "items-store": { journal: "shelf" }, notes: "notes" };
    const files = {
      ...projectFiles(),
      "/project/agentbay.config.yaml": yamlText({ ...config, bindings, modes: ["notes"] }),
    };
    const outcome = await loadSystem(fakeFileSystem(files), separateLayout);
    assert.deepEqual(refusal(outcome), [
      {
        file: "agentbay.config.yaml",
        path: "/bindings/items-store",
        line: 3,
        message: "Mode notes requires items-store@1, but bindings.items-store has no entry for notes and no default.",
        fix: "Add notes: <mode> or default: <mode> under bindings.items-store; modes that implement items-store@1: store, shelf.",
      },
    ]);
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
  const outcome = await loadSystem(files, loadedLayout);
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
    assert.deepEqual(Array.from(system.inactive), ["briefing"]);
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

  test("an action whose input schema could not be read cannot be loaded, so it is never listed", async () => {
    const files = { ...validFiles(), "components/base/store/schemas/put-input.json": "{ not json" };
    const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
    assert.deepEqual(refusal(outcome), [
      {
        file: "components/base/store/mode.yaml",
        path: "/actions/put/input",
        line: 9,
        message:
          "Action put of mode store names the input schema schemas/put-input.json, " +
          "but components/base/store/schemas/put-input.json is not valid JSON: " +
          "Expected property name or '}' in JSON at position 2 (line 1 column 3).",
        fix: "Correct the JSON in components/base/store/schemas/put-input.json.",
      },
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
      const outcome = await loadSystem(fakeFileSystem(rooted(files)), layout);
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

  test("only a string that starts with $ is a reference", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    assert.deepEqual(target.resolve("price $5", afterWrite), { ok: true, value: "price $5" });
    assert.deepEqual(target.resolve({ price: 5, nested: { value: "$trigger" } }, afterWrite), {
      ok: true,
      value: { price: 5, nested: { value: "$trigger" } },
    });
  });

  test("the four reference forms resolve, and nothing else is a reference", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    const withItem = { ...afterWrite, item: "x" };
    assert.deepEqual(target.resolve("$trigger", withItem), { ok: true, value: { topic: "tea" } });
    assert.deepEqual(target.resolve("$item", withItem), { ok: true, value: "x" });
    assert.deepEqual(target.resolve("$settings.lookback", withItem), { ok: true, value: "3d" });
    assert.deepEqual(target.resolve("$steps.write.output.items.0.id", withItem), { ok: true, value: "a" });
    for (const text of ["$", "$trigger.topic", "$item.id", "$steps.write", "$steps.write.input", "$settings", "$x"]) {
      const resolved = target.resolve(text, withItem);
      assert.ok(!resolved.ok, text);
      assert.deepEqual(
        resolved.problems.map((problem) => problem.message),
        [
          `${text} is not a reference: write $trigger, $item, $settings.<key> or $steps.<id>.output with an optional ` +
            "dotted path such as .items.0. Every value that starts with $ is read as a reference.",
        ],
      );
    }
  });

  test("references resolve whole against the trigger, step outputs, the item and settings", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    const outputs = new Map<string, Json>([
      ["fetch", { items: [{ id: "a" }, { id: "b" }], total: null }],
      ["count", 2],
    ]);
    const scope = { trigger: { topic: "staking" }, outputs };
    assert.deepEqual(target.resolve("$steps.fetch.output.items.1.id", scope), { ok: true, value: "b" });
    assert.deepEqual(target.resolve("$steps.fetch.output.total", scope), { ok: true, value: null });
    assert.deepEqual(target.resolve("$steps.count.output", scope), { ok: true, value: 2 });
    assert.deepEqual(target.resolve("plain text with $trigger inside", scope), {
      ok: true,
      value: "plain text with $trigger inside",
    });
  });

  test("a reference that resolves to nothing is a problem naming it and what was available", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    const outputs = new Map<string, Json>([
      ["fetch", { items: [{ id: "a" }, { id: "b" }], total: null }],
      ["count", 2],
    ]);
    const problemsOf = (text: string): readonly string[] => {
      const resolution = target.resolve(text, { trigger: null, outputs });
      assert.ok(!resolution.ok, text);
      return resolution.problems.map((problem) => problem.message);
    };
    assert.deepEqual(problemsOf("$steps.later.output"), [
      "$steps.later.output resolves to nothing: no step later has finished before it (available: fetch, count).",
    ]);
    assert.deepEqual(problemsOf("$steps.fetch.output.items.7"), [
      "$steps.fetch.output.items.7 resolves to nothing: output.items of step fetch has no 7; it is a list of 2 elements.",
    ]);
    assert.deepEqual(problemsOf("$steps.fetch.output.items.2"), [
      "$steps.fetch.output.items.2 resolves to nothing: output.items of step fetch has no 2; it is a list of 2 elements.",
    ]);
    assert.deepEqual(problemsOf("$steps.fetch.output.size"), [
      "$steps.fetch.output.size resolves to nothing: output of step fetch has no size; " +
        "it is a mapping with the keys items, total.",
    ]);
    assert.deepEqual(problemsOf("$steps.count.output.x"), [
      "$steps.count.output.x resolves to nothing: output of step count has no x; it is the value 2.",
    ]);
  });

  test("an input mapping resolves each top-level value and reports every problem at once", async () => {
    const target = await workflowTarget("briefing", "workflows/morning.yaml");
    const failed = target.resolve({ first: "$steps.nope.output", second: "$bad", fine: "$trigger" }, afterWrite);
    assert.deepEqual(failed, {
      ok: false,
      problems: [
        sentence(
          "input.first: $steps.nope.output resolves to nothing: no step nope has finished before it (available: write).",
        ),
        sentence(
          "input.second: $bad is not a reference: write $trigger, $item, $settings.<key> or $steps.<id>.output " +
            "with an optional dotted path such as .items.0. Every value that starts with $ is read as a reference.",
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

  test("an output schema file that is not JSON gives a problem when a value is checked, though the load passed", async () => {
    const files = filesWithSkill(draftSkill);
    await files.writeAtomic(noteDraft, "{ not json");
    const skill = await (await notesMode(files)).skill("skills/write-note");
    assert.ok(skill.ok);
    assert.deepEqual(skill.value.output?.check({ text: "Tea" }), {
      ok: false,
      problems: [
        {
          file: noteDraft,
          path: "",
          message:
            `The schema file ${noteDraft} is not valid JSON: ` +
            "Expected property name or '}' in JSON at position 2 (line 1 column 3).",
        },
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

  test("each skill of a mode answers with its own tools", async () => {
    const tidy = {
      description: "When the owner wants the notes tidied.",
      input: "schemas/add-input.json",
      output: "schemas/add-output.json",
      effects: ["read"],
      run: [{ skill: "skills/tidy", tier: "fast" }],
    };
    const manifest = { ...notesManifest, actions: { ...notesManifest.actions, tidy } };
    const tidySkill = "---\nname: tidy\ndescription: Tidies the notes.\n---\n\n## Tools\n\n- db\n";
    const files = filesWithSkill(draftSkill);
    await files.writeAtomic(`/kit/${paths.notes}`, yamlText(manifest));
    await files.writeAtomic("/kit/components/modes/notes/skills/tidy/SKILL.md", tidySkill);
    const mode = await notesMode(files);
    const tools = async (name: string): Promise<readonly string[]> => {
      const skill = await mode.skill(name);
      assert.ok(skill.ok, skill.ok ? "" : JSON.stringify(skill.problems));
      return skill.value.tools;
    };
    assert.deepEqual(await tools("skills/write-note"), ["files", "items-store.get", "http"]);
    assert.deepEqual(await tools("skills/tidy"), ["db"]);
  });
});

type Fixture = {
  readonly files: Readonly<Record<string, string>>;
  readonly layout: typeof layout;
};

const tidyMode = [
  "name: tidy",
  "version: 1.0.0",
  "description: Tidies the notes.",
  "actions:",
  "  sweep:",
  "    input: schemas/sweep.json",
  "    output: schemas/sweep.json",
  "    effects: [read]",
  "    run:",
  "      - script: scripts/sweep.ts",
  "",
].join("\n");

const grabbingJournal = [
  "name: journal",
  "version: 1.0.0",
  "description: Keeps a journal on the shelf.",
  "requires:",
  "  interfaces: [items-store@1]",
  "resources:",
  "  files:",
  "    write:",
  "      - .agentbay/data/",
  "actions:",
  "  write:",
  "    description: When the owner writes an entry.",
  "    input: schemas/write-input.json",
  "    output: schemas/write-output.json",
  "    effects: [read, write]",
  "    run:",
  "      - call: items-store.put",
  "",
].join("\n");

const fixtures = {
  soundKit: { files: rooted(validFiles()), layout },
  soundProject: { files: projectFiles(), layout: separateLayout },
  unreadableManifest: {
    files: rooted({ ...validFiles(), "components/modes/broken/mode.yaml": "name: broken\nversion: [\n" }),
    layout,
  },
  schemaRule: { files: rooted({ ...validFiles(), "components/modes/tidy/mode.yaml": tidyMode }), layout },
  grantRule: {
    files: { ...projectFiles(), "/project/components/modes/journal/mode.yaml": grabbingJournal },
    layout: separateLayout,
  },
  unreadableSkill: {
    files: rooted(
      Object.fromEntries(
        Object.entries(validFiles()).filter(([path]) => path !== "components/modes/notes/skills/write-note/SKILL.md"),
      ),
    ),
    layout,
  },
} satisfies Readonly<Record<string, Fixture>>;

async function inspectionOf(fixture: Fixture): Promise<Inspection> {
  return inspectSystem(fakeFileSystem(fixture.files), fixture.layout);
}

function foldersOf(inspection: Inspection): readonly unknown[] {
  return inspection.folders.map((folder) => [
    folder.home,
    folder.tier,
    folder.folder,
    folder.active,
    folder.manifest?.name,
  ]);
}

function readFolder(inspection: Inspection, folder: string): Extract<InspectedFolder, { readonly manifest: object }> {
  const found = inspection.folders.find((entry) => entry.folder === folder);
  assert.ok(found?.manifest !== undefined, `${folder} was not read`);
  return found;
}

describe("inspectSystem", () => {
  test("in a sound kit every mode folder is found, read and active, with the interfaces and no problem", async () => {
    const inspection = await inspectionOf(fixtures.soundKit);
    assert.deepEqual([inspection.problems, inspection.notices], [[], []]);
    assert.deepEqual(foldersOf(inspection), [
      ["kit", "base", "/kit/components/base/store", true, "store"],
      ["kit", "modes", "/kit/components/modes/briefing", true, "briefing"],
      ["kit", "modes", "/kit/components/modes/notes", true, "notes"],
    ]);
    assert.deepEqual([...inspection.interfaces.keys()].sort(), ["items-store@1", "notes@1"]);
    assert.deepEqual(inspection.interfaces.get("notes@1")?.actions.add?.effects, ["read", "write"]);
    assert.deepEqual(inspection.kitLayout, {
      components: "components",
      tiers: ["components/base", "components/modes"],
      interfaces: "components/base/interfaces",
    });
  });

  test("in a sound project the kit's modes come first, and a kit mode nothing reaches is not active", async () => {
    const inspection = await inspectionOf(fixtures.soundProject);
    assert.deepEqual([inspection.problems, inspection.notices], [[], []]);
    assert.deepEqual(foldersOf(inspection), [
      ["kit", "base", "/kit/components/base/store", true, "store"],
      ["kit", "modes", "/kit/components/modes/briefing", false, "briefing"],
      ["kit", "modes", "/kit/components/modes/notes", true, "notes"],
      ["project", "modes", "/project/components/modes/journal", true, "journal"],
      ["project", "modes", "/project/components/modes/shelf", true, "shelf"],
    ]);
  });

  test("a folder is active by the name in its manifest, not by the name of its folder", async () => {
    const renamed = Object.entries(projectFiles()).map(([path, text]): readonly [string, string] => [
      path.replace("/kit/components/modes/briefing/", "/kit/components/modes/daily/"),
      text,
    ]);
    const projectConfig = yamlText({ ...config, modes: ["notes", "briefing"] });
    const files = { ...Object.fromEntries(renamed), "/project/agentbay.config.yaml": projectConfig };
    const inspection = await inspectionOf({ files, layout: separateLayout });
    assert.deepEqual(foldersOf(inspection)[1], ["kit", "modes", "/kit/components/modes/daily", true, "briefing"]);
  });

  test("the interfaces folder is not a mode folder, and other files in it are not interfaces", async () => {
    const files = {
      ...validFiles(),
      "components/base/interfaces/mode.yaml": "name: stray\n",
      "components/base/interfaces/notes.md": "not an interface",
      "components/base/lint/README.md": "configs, not a mode",
    };
    const inspection = await inspectionOf({ files: rooted(files), layout });
    assert.deepEqual(
      inspection.folders.map((folder) => folder.folder),
      ["/kit/components/base/store", "/kit/components/modes/briefing", "/kit/components/modes/notes"],
    );
    assert.deepEqual([...inspection.interfaces.keys()].sort(), ["items-store@1", "notes@1"]);
    assert.deepEqual(inspection.problems, [
      {
        file: "components/base/interfaces/mode.yaml",
        path: "",
        message: "components/base/interfaces holds interface files only, but it has a mode.yaml.",
        fix: "Move the mode to a folder of its own, such as components/modes/<mode>/mode.yaml.",
      },
    ]);
  });

  test("a mode whose mode.yaml cannot be read is found without a manifest, and its problem has the line", async () => {
    const inspection = await inspectionOf(fixtures.unreadableManifest);
    assert.deepEqual(foldersOf(inspection)[2], ["kit", "modes", "/kit/components/modes/broken", true, undefined]);
    assert.deepEqual(inspection.problems, [
      {
        file: "components/modes/broken/mode.yaml",
        path: "",
        line: 3,
        message:
          "The YAML cannot be read: Flow sequence in block collection must be sufficiently indented and end with a ].",
        fix: "Correct the YAML syntax at this line.",
      },
    ]);
  });

  test("a mode that breaks a schema rule is found without a manifest, and its problem is on the line", async () => {
    const inspection = await inspectionOf(fixtures.schemaRule);
    assert.deepEqual(foldersOf(inspection)[3], ["kit", "modes", "/kit/components/modes/tidy", true, undefined]);
    assert.deepEqual(inspection.problems, [
      {
        file: "components/modes/tidy/mode.yaml",
        path: "/actions/sweep",
        line: 6,
        message: "actions.sweep is missing the required field description.",
        fix: "Add description. Expected: One sentence saying when an owner or a mode would use the action.",
      },
    ]);
  });

  test("a mode that breaks a grant rule is read, and its problem is on the line of the path", async () => {
    const inspection = await inspectionOf(fixtures.grantRule);
    assert.equal(readFolder(inspection, "/project/components/modes/journal").manifest.name, "journal");
    assert.deepEqual(inspection.problems, [
      {
        file: "components/modes/journal/mode.yaml",
        path: "/resources/files/write/0",
        line: 9,
        message: "The path .agentbay/data/ points into the kernel's state folder .agentbay/, which no mode may name.",
        fix: "Name a folder outside the kernel, state and other modes' folders, and outside the mode's own code.",
      },
    ]);
  });

  test("a skill whose file cannot be read is a problem of the step, and is given without its text", async () => {
    const inspection = await inspectionOf(fixtures.unreadableSkill);
    assert.deepEqual(inspection.problems, [
      {
        file: "components/modes/notes/mode.yaml",
        path: "/actions/add/run/0/skill",
        line: 18,
        message:
          "Action add of mode notes runs the skill skills/write-note, " +
          "but components/modes/notes/skills/write-note/SKILL.md does not exist.",
        fix: "Create components/modes/notes/skills/write-note/SKILL.md, or correct the path.",
      },
    ]);
    const notes = readFolder(inspection, "/kit/components/modes/notes");
    assert.deepEqual(await notes.skill("skills/write-note"), {
      file: "/kit/components/modes/notes/skills/write-note/SKILL.md",
      text: undefined,
    });
  });

  test("a skill is given with its front matter, the line of its name and its sections with their list items", async () => {
    const text = [
      "---",
      "name: write-note",
      "description: Writes one note from the input.",
      "---",
      "",
      "## Tools",
      "",
      "- `items-store.put`: stores the note",
      "```",
      "- fenced",
      "```",
      "1. db",
      "",
    ].join("\n");
    const files = rooted({ ...validFiles(), "components/modes/notes/skills/write-note/SKILL.md": text });
    const notes = readFolder(await inspectionOf({ files, layout }), "/kit/components/modes/notes");
    assert.deepEqual(await notes.skill("skills/write-note"), {
      file: "/kit/components/modes/notes/skills/write-note/SKILL.md",
      text: {
        frontMatter: {
          ok: true,
          value: { name: "write-note", description: "Writes one note from the input." },
        },
        nameLine: 2,
        sections: [
          {
            heading: "Tools",
            line: 6,
            lines: [
              { line: 7, text: "" },
              { line: 8, text: "- `items-store.put`: stores the note" },
              { line: 9, text: "```" },
              { line: 10, text: "- fenced" },
              { line: 11, text: "```" },
              { line: 12, text: "1. db" },
              { line: 13, text: "" },
            ],
            items: [
              { line: 8, text: "- `items-store.put`: stores the note", entry: "items-store.put" },
              { line: 12, text: "1. db", entry: "db" },
            ],
          },
        ],
      },
    });
  });

  test("a read folder places a problem at a path of its manifest, with the line", async () => {
    const notes = readFolder(await inspectionOf(fixtures.soundKit), "/kit/components/modes/notes");
    assert.deepEqual(notes.at(["requires", "interfaces", 0], { message: "Look here.", fix: "Fix it." }), {
      file: "/kit/components/modes/notes/mode.yaml",
      path: "/requires/interfaces/0",
      line: 6,
      message: "Look here.",
      fix: "Fix it.",
    });
  });

  test("a read folder checks a value against a schema of its mode, and says nothing of a schema it cannot use", async () => {
    const files = rooted({
      ...validFiles(),
      "components/modes/notes/schemas/strict.json": JSON.stringify({ type: "object", required: ["text"] }),
      "components/modes/notes/schemas/unusable.json": JSON.stringify({ type: "mapping" }),
      "components/modes/notes/schemas/broken.json": "{ not json",
    });
    const notes = readFolder(await inspectionOf({ files, layout }), "/kit/components/modes/notes");
    const example = "/kit/components/modes/notes/tests/add.example.json";
    const against = (schema: string): { readonly schema: string; readonly file: string; readonly under: string } => ({
      schema,
      file: example,
      under: "input",
    });
    assert.deepEqual(await notes.schemaProblems({ text: "Tea" }, against("schemas/strict.json")), []);
    assert.deepEqual(await notes.schemaProblems({}, against("schemas/strict.json")), [
      { file: example, path: "/input", message: "input is missing the required field text.", fix: "Add text." },
    ]);
    for (const schema of ["schemas/unusable.json", "schemas/broken.json", "schemas/gone.json"]) {
      assert.deepEqual(await notes.schemaProblems({}, against(schema)), []);
    }
  });

  test("a kit mode that does not load is a notice while it is not active in the project", async () => {
    const files = { ...projectFiles(), "/kit/components/modes/todo/mode.yaml": "name: todo\n" };
    const inspection = await inspectionOf({ files, layout: separateLayout });
    assert.deepEqual(inspection.problems, []);
    assert.deepEqual(
      inspection.notices.map((notice) => [notice.file, notice.message.split(" (")[0]]),
      [["kit:components/modes/todo/mode.yaml", "Mode todo of the kit does not load"]],
    );
  });
});

describe("a load and an inspection agree", () => {
  test("for each fixture, a load gives a system exactly when the inspection reports no problem", async () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      const files = fakeFileSystem(fixture.files);
      const inspection = await inspectSystem(files, fixture.layout);
      const loaded = await loadSystem(files, fixture.layout);
      assert.equal(loaded.ok, inspection.problems.length === 0, name);
      assert.deepEqual(loaded.ok ? [] : loaded.problems, inspection.problems, name);
    }
  });
});

const kebabFix =
  "Start with a lowercase letter and use only lowercase letters, digits and single dashes, such as daily-digest.";

const takenName = { path: "", fix: "Choose another name." };

async function placed(fixture: Fixture, part: NewPart): ReturnType<typeof placeToWrite> {
  return placeToWrite(fakeFileSystem(fixture.files), fixture.layout, part);
}

describe("placeToWrite", () => {
  test("in a project, a new mode, a part of a project mode and a new interface go into the project", async () => {
    const project = fixtures.soundProject;
    assert.deepEqual(await placed(project, { mode: "diary", tier: "modes" }), {
      ok: true,
      value: "components/modes/diary",
    });
    assert.deepEqual(await placed(project, { inMode: "journal", kind: "action", name: "log" }), {
      ok: true,
      value: "components/modes/journal",
    });
    assert.deepEqual(await placed(project, { interface: "diary" }), {
      ok: true,
      value: "components/interfaces/diary.yaml",
    });
  });

  test("in the kit, a new base mode, a part of a kit mode and a new interface go into the kit", async () => {
    const kit = fixtures.soundKit;
    assert.deepEqual(await placed(kit, { mode: "diary", tier: "base" }), {
      ok: true,
      value: "components/base/diary",
    });
    assert.deepEqual(await placed(kit, { mode: "diary", tier: "modes" }), {
      ok: true,
      value: "components/modes/diary",
    });
    assert.deepEqual(await placed(kit, { inMode: "store", kind: "workflow", name: "nightly" }), {
      ok: true,
      value: "components/base/store",
    });
    assert.deepEqual(await placed(kit, { interface: "diary" }), {
      ok: true,
      value: "components/base/interfaces/diary.yaml",
    });
  });

  test("a base mode is refused outside the kit, together with a name that is not kebab-case", async () => {
    const tier = {
      path: "",
      message:
        "Tier base is for the base modes of the kit itself, and this project is not the kit; " +
        "bay new writes only into the project.",
      fix: "Make the mode in this project with --tier modes, or run bay new in the kit's own folder.",
    };
    assert.deepEqual(await placed(fixtures.soundProject, { mode: "diary", tier: "base" }), {
      ok: false,
      problems: [{ file: "components/base/diary", ...tier }],
    });
    assert.deepEqual(await placed(fixtures.soundProject, { mode: "Bad_Name", tier: "base" }), {
      ok: false,
      problems: [
        { file: "components/base/Bad_Name", ...tier },
        {
          file: "components/base/Bad_Name",
          path: "",
          message: 'The mode name "Bad_Name" is not kebab-case.',
          fix: kebabFix,
        },
      ],
    });
  });

  test("a name that is not kebab-case or is reserved is refused for each kind of part", async () => {
    const project = fixtures.soundProject;
    assert.deepEqual(await placed(project, { mode: "constructor", tier: "modes" }), {
      ok: false,
      problems: [
        {
          file: "components/modes/constructor",
          path: "",
          message: "The mode name constructor is reserved, because every JavaScript object has it.",
          fix: "Choose another name.",
        },
      ],
    });
    assert.deepEqual(await placed(project, { inMode: "journal", kind: "action", name: "Bad" }), {
      ok: false,
      problems: [
        {
          file: "components/modes/journal",
          path: "",
          message: 'The action name "Bad" is not kebab-case.',
          fix: kebabFix,
        },
      ],
    });
    assert.deepEqual(await placed(project, { interface: "Bad" }), {
      ok: false,
      problems: [
        {
          file: "components/interfaces/Bad.yaml",
          path: "",
          message: 'The interface name "Bad" is not kebab-case.',
          fix: kebabFix,
        },
      ],
    });
  });

  test("a new mode whose name is taken, in the kit or in the project, is refused", async () => {
    assert.deepEqual(await placed(fixtures.soundProject, { mode: "store", tier: "modes" }), {
      ok: false,
      problems: [
        {
          file: "kit:components/base/store",
          message: "kit:components/base/store already exists; every mode needs its own name.",
          ...takenName,
        },
      ],
    });
    assert.deepEqual(await placed(fixtures.soundProject, { mode: "journal", tier: "modes" }), {
      ok: false,
      problems: [
        {
          file: "components/modes/journal",
          message: "components/modes/journal already exists; every mode needs its own name.",
          ...takenName,
        },
      ],
    });
    assert.deepEqual(await placed(fixtures.soundKit, { mode: "store", tier: "modes" }), {
      ok: false,
      problems: [
        {
          file: "components/base/store",
          message: "components/base/store already exists; every mode needs its own name.",
          ...takenName,
        },
      ],
    });
  });

  test("a part of a mode that does not exist is refused, naming where it was looked for", async () => {
    const missing = { file: "components", path: "", fix: "Name an existing mode, or create it with bay new mode." };
    assert.deepEqual(await placed(fixtures.soundProject, { inMode: "nosuch", kind: "workflow", name: "Bad" }), {
      ok: false,
      problems: [
        { ...missing, message: "There is no mode nosuch: neither components/modes/nosuch has a mode.yaml." },
        { file: "nosuch", path: "", message: 'The workflow name "Bad" is not kebab-case.', fix: kebabFix },
      ],
    });
    assert.deepEqual(await placed(fixtures.soundKit, { inMode: "nosuch", kind: "skill", name: "tidy" }), {
      ok: false,
      problems: [
        {
          ...missing,
          message:
            "There is no mode nosuch: neither components/base/nosuch or components/modes/nosuch has a mode.yaml.",
        },
      ],
    });
  });

  test("a part of a kit mode is refused outside the kit", async () => {
    assert.deepEqual(await placed(fixtures.soundProject, { inMode: "notes", kind: "skill", name: "tidy" }), {
      ok: false,
      problems: [
        {
          file: "kit:components/modes/notes",
          path: "",
          message:
            "Mode notes lives in the kit (kit:components/modes/notes), " +
            "and bay new writes only into the project, never into the kit.",
          fix: "Make a mode of your own with bay new mode, or change the kit's mode in the kit's own folder.",
        },
      ],
    });
  });
});
