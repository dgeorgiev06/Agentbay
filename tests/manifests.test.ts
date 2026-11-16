import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadSystemReport, type ActionsListing, type System } from "../bay/manifests/manifests.ts";
import { fakeFileSystem } from "./fakes.ts";
import { config, layout, paths, rooted, schemaText, separateLayout, validFiles, yamlText } from "./system-fixture.ts";

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
