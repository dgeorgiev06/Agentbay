import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { fieldsOf } from "../scripts/lib/json.ts";
import { bayIn, kit } from "./bay-command.ts";

const project = realpathSync(mkdtempSync(join(tmpdir(), "agentbay-two-briefings-")));

after(() => {
  rmSync(project, { recursive: true, force: true });
});

const { ran: bay, succeeded } = bayIn(project);

function outputOf(argv: readonly string[]): Json {
  const run = fieldsOf(fieldsOf(succeeded(argv)).run ?? null);
  assert.equal(run.status, "done", JSON.stringify(run));
  return run.output ?? null;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), text, "utf8");
}

function writeJson(path: string, value: Json): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeConfig(itemsSource: Json): void {
  const config = {
    modes: ["feed-briefing"],
    adapter: "claude-code",
    bindings: { "items-store": "store", "items-source": itemsSource },
    settings: {
      "feed-briefing": { selector: {}, lookback: "14d", maxItems: 100 },
      "fake-source": { baseDate: "2026-11-15T12:00:00Z", pageSize: 10, costPerItemUsd: 0.001 },
    },
  };
  writeJson("agentbay.config.yaml", config);
}

const notesSync = [
  'import { defineScript, fail, type Json, type ScriptContext } from "agentbay/sdk";',
  "",
  "async function called(context: ScriptContext, reference: string, input: Json): Promise<Json> {",
  "  const answer = await context.call(reference, input);",
  "  return answer.ok ? answer.value : fail(answer.message);",
  "}",
  "",
  "function fieldsOf(value: Json): { readonly [key: string]: Json } {",
  '  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};',
  "}",
  "",
  "export const run = defineScript(async (_input, context) => {",
  '  const page = fieldsOf(await called(context, "items-source.fetch", { selector: {}, cursor: null }));',
  "  const { source, kinds, items, cursor, cost } = page;",
  "  const put = { source: source ?? null, kinds: kinds ?? [], items: items ?? [], cursor: cursor ?? null };",
  '  const stored = fieldsOf(await called(context, "items-store.put", { ...put, cost: cost ?? null }));',
  "  return { source: source ?? null, added: stored.added ?? 0 };",
  "});",
  "",
].join("\n");

const twoItems = [0, 1].map((index) => ({
  id: `two:${String(index + 1)}`,
  kind: "note",
  source: "two",
  at: `2026-11-14T0${String(8 + index)}:00:00Z`,
  title: `Note ${String(index + 1)}`,
  text: `Note ${String(index + 1)} of fake-two.`,
  url: null,
  author: "two",
  labels: [],
  data: {},
}));

function sourceScript(output: Json): string {
  const value = JSON.stringify(output);
  const lines = [
    'import { defineScript } from "agentbay/sdk";',
    "",
    `export const run = defineScript(() => Promise.resolve(${value}));`,
  ];
  return `${lines.join("\n")}\n`;
}

function writeNotesBriefing(): void {
  const folder = "components/modes/notes-briefing";
  const interfaces = join(kit, "components/base/interfaces/items-store");
  const syncSteps = { effects: ["read", "write", "network", "spend"], run: [{ script: "scripts/sync.ts" }] };
  const manifest = {
    name: "notes-briefing",
    version: "0.1.0",
    description: "Fetches one page from its bound source and keeps it in its own part of the store.",
    requires: { interfaces: ["items-source@1", "items-store@1"] },
    actions: {
      sync: {
        description: "When the owner wants one page from the bound source kept.",
        input: "schemas/sync-input.json",
        output: "schemas/sync-output.json",
        ...syncSteps,
      },
      status: {
        description: "When the owner wants the store's counts.",
        input: "schemas/status-request.json",
        output: "schemas/status-response.json",
        effects: ["read"],
        run: [{ call: "items-store.status" }],
      },
    },
  };
  writeJson(`${folder}/mode.yaml`, manifest);
  write(`${folder}/scripts/sync.ts`, notesSync);
  writeJson(`${folder}/schemas/sync-input.json`, { type: "object", additionalProperties: false, properties: {} });
  writeJson(`${folder}/schemas/sync-output.json`, {
    type: "object",
    additionalProperties: false,
    required: ["source", "added"],
    properties: { source: { type: "string" }, added: { type: "integer", minimum: 0 } },
  });
  writeJson(`${folder}/tests/sync.example.json`, { input: {}, output: { source: "fake", added: 10 } });
  writeJson(`${folder}/tests/status.example.json`, { input: {}, output: { items: 0, deletions: 0, sources: [] } });
  for (const name of ["status-request.json", "status-response.json"]) {
    copyFileSync(join(interfaces, name), join(project, folder, "schemas", name));
  }
}

function writeFakeTwo(): void {
  const folder = "components/modes/fake-two";
  const interfaces = join(kit, "components/base/interfaces/items-source");
  const fetched = {
    source: "two",
    kinds: ["note"],
    items: twoItems,
    cursor: null,
    more: false,
    cost: { items: 0, usd: 0 },
  };
  const described = { source: "two", kinds: ["note"], nativeFields: [] };
  const manifest = {
    name: "fake-two",
    version: "0.1.0",
    description: "Serves two made-up notes as an items-source.",
    implements: ["items-source@1"],
    actions: {
      fetch: {
        description: "When a mode needs the made-up notes.",
        input: "schemas/fetch-request.json",
        output: "schemas/fetch-response.json",
        effects: ["read", "network", "spend"],
        run: [{ script: "scripts/fetch.ts" }],
      },
      describe: {
        description: "When a mode needs the source's name and kinds.",
        input: "schemas/describe-request.json",
        output: "schemas/describe-response.json",
        effects: ["read"],
        run: [{ script: "scripts/describe.ts" }],
      },
    },
  };
  writeJson(`${folder}/mode.yaml`, manifest);
  write(`${folder}/scripts/fetch.ts`, sourceScript(fetched));
  write(`${folder}/scripts/describe.ts`, sourceScript(described));
  writeJson(`${folder}/tests/fetch.example.json`, { input: { selector: {}, cursor: null }, output: fetched });
  writeJson(`${folder}/tests/describe.example.json`, { input: {}, output: described });
  mkdirSync(join(project, folder, "schemas"), { recursive: true });
  for (const name of ["fetch-request", "fetch-response", "describe-request", "describe-response"]) {
    copyFileSync(join(interfaces, `${name}.json`), join(project, folder, "schemas", `${name}.json`));
  }
}

function sourcesIn(partition: string): readonly string[] {
  const database = new DatabaseSync(join(project, ".agentbay", "data", `store--${partition}.db`), { readOnly: true });
  try {
    const rows = database.prepare("select source, count(*) as items from items group by source order by source").all();
    return rows.map((row) => `${String(row.source)}: ${String(row.items)}`);
  } finally {
    database.close();
  }
}

test("two briefings bound to two sources through bay: each partition holds only its own source's items", () => {
  spawnSync("git", ["init", "-q"], { cwd: project });
  writeConfig({ "feed-briefing": "fake-source", "notes-briefing": "fake-source" });
  succeeded(["new", "mode", "notes-briefing"]);
  succeeded(["new", "action", "sync", "--mode", "notes-briefing"]);
  writeNotesBriefing();
  assert.equal(fieldsOf(succeeded(["check"])).errors, 0);
  assert.equal(fieldsOf(outputOf(["call", "notes-briefing.sync", "{}"])).source, "fake");
  succeeded(["new", "mode", "fake-two"]);
  writeFakeTwo();
  writeConfig({ "feed-briefing": "fake-source", "notes-briefing": "fake-two" });
  rmSync(join(project, ".agentbay"), { recursive: true, force: true });
  assert.equal(fieldsOf(succeeded(["check"])).errors, 0);
  const config = succeeded(["config"]);
  assert.deepEqual(fieldsOf(config).bindings, [
    { interfaceName: "items-source", requirers: ["feed-briefing"], servedBy: "fake-source" },
    { interfaceName: "items-source", requirers: ["notes-briefing"], servedBy: "fake-two" },
    { interfaceName: "items-store", requirers: ["feed-briefing", "notes-briefing"], servedBy: "store" },
  ]);
  const feed = outputOf(["call", "feed-briefing.sync", '{"since":"2026-11-01T00:00:00Z"}']);
  assert.deepEqual([fieldsOf(feed).source, fieldsOf(feed).added], ["fake", 30]);
  assert.deepEqual(outputOf(["call", "notes-briefing.sync", "{}"]), { source: "two", added: 2 });
  const status = outputOf(["call", "notes-briefing.status", "{}"]);
  assert.equal(fieldsOf(status).items, 2);
  assert.deepEqual(sourcesIn("notes-briefing"), ["two: 2"]);
  assert.deepEqual(sourcesIn("feed-briefing"), ["fake: 30"]);
});

test("bay check names the requirer that has no source, and an entry for a mode that is not there", () => {
  writeConfig({ "feed-briefing": "fake-source" });
  const unbound = bay(["check"]);
  assert.equal(unbound.status, 1);
  assert.match(unbound.output, /Mode notes-briefing requires items-source@1, but bindings\.items-source has no entry/);
  writeConfig({ "feed-briefing": "fake-source", "notes-briefing": "fake-two", journal: "fake-two" });
  const stale = bay(["check"]);
  assert.equal(stale.status, 1);
  assert.match(stale.output, /bindings\.items-source has an entry for journal, which is not a mode/);
});
