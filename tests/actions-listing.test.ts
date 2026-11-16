import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutOf, type Layout } from "../bay/layout.ts";
import type { Problem } from "../bay/outcome.ts";
import type { FileSystem } from "../bay/ports.ts";
import { actionsListing, loadSystemReport, type ActionsListing, type System } from "../bay/registry.ts";
import { modeNamed, systemOf } from "./broker-fixture.ts";
import { fakeFileSystem } from "./fakes.ts";
import { config, layout, rooted, schemaText, validFiles, yamlText } from "./system-fixture.ts";

async function loadedSystem(files: FileSystem, loadedLayout: Layout = layout): Promise<System> {
  const outcome = (await loadSystemReport(files, loadedLayout)).outcome;
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

async function kitSystem(): Promise<System> {
  return loadedSystem(fakeFileSystem(rooted(validFiles())));
}

function listed(outcome: ReturnType<typeof actionsListing>): ActionsListing {
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return outcome.value;
}

function refusedWith(outcome: ReturnType<typeof actionsListing>): readonly Problem[] {
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

test("asked with nothing, the listing gives each active mode's name and description, by name", async () => {
  assert.deepEqual(listed(actionsListing(await kitSystem(), {})), allModes);
});

test("asked with a mode, the listing gives its actions as mode.action, with description, effects and input schema", async () => {
  assert.deepEqual(listed(actionsListing(await kitSystem(), { mode: "store" })), {
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
  assert.deepEqual(refusedWith(actionsListing(await kitSystem(), { mode: "ledger" })), [
    {
      file: "",
      path: "",
      message: "There is no active mode ledger. The active modes are briefing, notes, store.",
      fix: "Name one of them, or leave the mode out to list them.",
    },
  ]);
});

const separate = layoutOf({ kit: "/kit", project: "/project" });

function separateProject(): FileSystem {
  const kit = Object.entries(validFiles()).filter(([path]) => path !== "agentbay.config.yaml");
  const projectConfig = yamlText({ ...config, modes: ["notes"], settings: {} });
  return fakeFileSystem({
    ...Object.fromEntries(kit.map(([path, text]) => [`/kit/${path}`, text])),
    "/project/agentbay.config.yaml": projectConfig,
  });
}

test("a mode that is loaded but not active is neither listed nor answered for", async () => {
  const system = await loadedSystem(separateProject(), separate);
  assert.ok(system.modes.has("briefing"));
  assert.deepEqual(listed(actionsListing(system, {})), {
    modes: [
      { name: "notes", description: "Writes notes into the store." },
      { name: "store", description: "Keeps items." },
    ],
  });
  assert.deepEqual(
    refusedWith(actionsListing(system, { mode: "briefing" })).map((problem) => problem.message),
    ["There is no active mode briefing. The active modes are notes, store."],
  );
});

test("find keeps the modes that hold every word in their name or description", async () => {
  const system = await kitSystem();
  assert.deepEqual(listed(actionsListing(system, { find: "writes daily" })), {
    modes: [{ name: "briefing", description: "Writes a daily briefing as a note." }],
  });
  assert.deepEqual(listed(actionsListing(system, { find: "writes note" })), {
    modes: [
      { name: "briefing", description: "Writes a daily briefing as a note." },
      { name: "notes", description: "Writes notes into the store." },
    ],
  });
});

test("find ignores case, in the words and in the text", async () => {
  const system = await kitSystem();
  assert.deepEqual(listed(actionsListing(system, { find: "KEEPS Items" })), {
    modes: [{ name: "store", description: "Keeps items." }],
  });
  assert.deepEqual(listed(actionsListing(system, { mode: "store", find: "Reads BACK" })), {
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
  const outcome = listed(actionsListing(await kitSystem(), { mode: "notes", find: "notes.add" }));
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
  assert.deepEqual(listed(actionsListing(system, { find: "zebra" })), { modes: [] });
  assert.deepEqual(listed(actionsListing(system, { mode: "store", find: "item zebra" })), {
    mode: "store",
    actions: [],
  });
});

test("the listing is live: a mode folder added to the project is listed on the next load", async () => {
  const files = fakeFileSystem(rooted(validFiles()));
  assert.deepEqual(listed(actionsListing(await loadedSystem(files), {})), allModes);
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
  assert.deepEqual(listed(actionsListing(again, {})), {
    modes: [
      { name: "briefing", description: "Writes a daily briefing as a note." },
      { name: "journal", description: "Keeps a journal." },
      { name: "notes", description: "Writes notes into the store." },
      { name: "store", description: "Keeps items." },
    ],
  });
  assert.deepEqual(listed(actionsListing(again, { mode: "journal" })), {
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

test("an action whose input schema could not be read gives a problem instead of a listing without it", () => {
  const system = systemOf([{ folder: "/kit/components/modes/probe", manifest: modeNamed("probe", undefined) }]);
  assert.deepEqual(refusedWith(actionsListing(system, { mode: "probe" })), [
    { file: "", path: "", message: "The input schema of probe.look could not be read.", fix: "Run bay check." },
  ]);
});
