import { stringify } from "yaml";
import type { Config } from "../bay/generated/config.ts";
import type { Interface } from "../bay/generated/interface.ts";
import type { Mode } from "../bay/generated/mode.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { layoutOf } from "../bay/layout.ts";

export const layout = layoutOf({ kit: "/kit", project: "/kit" });

export const paths = {
  itemsStore: "components/base/interfaces/items-store.yaml",
  notesInterface: "components/base/interfaces/notes.yaml",
  store: "components/base/store/mode.yaml",
  notes: "components/modes/notes/mode.yaml",
  briefing: "components/modes/briefing/mode.yaml",
  config: "agentbay.config.yaml",
} as const;

export const itemsStore: Interface = {
  name: "items-store",
  version: 1,
  actions: {
    put: { input: "items-store/put-input.json", output: "items-store/put-output.json", effects: ["write"] },
    get: { input: "items-store/get-input.json", output: "items-store/get-output.json", effects: ["read"] },
  },
};

const notesInterface: Interface = {
  name: "notes",
  version: 1,
  actions: {
    add: { input: "notes/add-input.json", output: "notes/add-output.json", effects: ["read", "write"] },
  },
};

export const storeMode: Mode = {
  name: "store",
  version: "1.0.0",
  description: "Keeps items.",
  implements: ["items-store@1"],
  actions: {
    put: {
      description: "When a mode keeps an item.",
      input: "schemas/put-input.json",
      output: "schemas/put-output.json",
      effects: ["write"],
      run: [{ script: "scripts/put.ts" }],
      undo: "remove",
    },
    get: {
      description: "When a mode reads an item back.",
      input: "schemas/get-input.json",
      output: "schemas/get-output.json",
      effects: ["read"],
      run: [{ script: "scripts/get.ts" }],
    },
    remove: {
      description: "When a kept item must go.",
      input: "schemas/put-output.json",
      output: "schemas/get-output.json",
      effects: ["delete"],
      run: [{ script: "scripts/remove.ts" }],
    },
  },
};

export const notesMode: Mode = {
  name: "notes",
  version: "1.0.0",
  description: "Writes notes into the store.",
  requires: { interfaces: ["items-store@1"] },
  implements: ["notes@1"],
  actions: {
    add: {
      description: "When the owner wants a note written.",
      input: "schemas/add-input.json",
      output: "schemas/add-output.json",
      effects: ["read", "write"],
      run: [{ skill: "skills/write-note", tier: "fast" }, { call: "items-store.put" }],
    },
  },
  workflows: ["workflows/daily.yaml"],
};

export const briefingMode: Mode = {
  name: "briefing",
  version: "1.0.0",
  description: "Writes a daily briefing as a note.",
  requires: { interfaces: ["notes@1"] },
  settings: "schemas/settings.json",
  actions: {
    digest: {
      description: "When the owner wants the daily briefing.",
      input: "schemas/digest-input.json",
      output: "schemas/digest-output.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/select.ts" }, { call: "notes.add" }],
    },
  },
};

export const config: Config = {
  bindings: { "items-store": "store", notes: "notes" },
  adapter: "local",
  settings: { briefing: { lookback: "3d" } },
};

export const briefingSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lookback"],
  properties: { lookback: { type: "string", pattern: "^[1-9][0-9]*d$" } },
};

const dailyWorkflow: Workflow = {
  name: "daily",
  trigger: { schedule: "0 7 * * *" },
  steps: [
    { id: "write", action: "add" },
    { id: "check", action: "items-store.get" },
    { id: "keep", approval: "Keep this note?" },
  ],
};

const writeNoteSkill = [
  "---",
  "name: write-note",
  "description: Writes one note from the input.",
  "---",
  "",
  "## Input",
  "",
].join("\n");

export function schemaText(title: string): string {
  return `${JSON.stringify({ title, type: "object" }, null, 2)}\n`;
}

export function yamlText(value: unknown): string {
  return stringify(value);
}

function schemaFiles(folder: string, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [`${folder}/${name}.json`, schemaText(name)]));
}

export function validFiles(): Record<string, string> {
  return {
    [paths.itemsStore]: yamlText(itemsStore),
    [paths.notesInterface]: yamlText(notesInterface),
    ...schemaFiles("components/base/interfaces/items-store", ["put-input", "put-output", "get-input", "get-output"]),
    ...schemaFiles("components/base/interfaces/notes", ["add-input", "add-output"]),
    [paths.store]: yamlText(storeMode),
    ...schemaFiles("components/base/store/schemas", ["put-input", "put-output", "get-input", "get-output"]),
    "components/base/store/scripts/put.ts": "",
    "components/base/store/scripts/get.ts": "",
    "components/base/store/scripts/remove.ts": "",
    [paths.notes]: yamlText(notesMode),
    ...schemaFiles("components/modes/notes/schemas", ["add-input", "add-output"]),
    "components/modes/notes/skills/write-note/SKILL.md": writeNoteSkill,
    "components/modes/notes/workflows/daily.yaml": yamlText(dailyWorkflow),
    [paths.briefing]: yamlText(briefingMode),
    ...schemaFiles("components/modes/briefing/schemas", ["digest-input", "digest-output"]),
    "components/modes/briefing/scripts/select.ts": "",
    "components/modes/briefing/schemas/settings.json": JSON.stringify(briefingSettingsSchema),
    [paths.config]: yamlText(config),
  };
}

export function rooted(files: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, text]) => [`${layout.project}/${path}`, text]));
}
