import { stringify } from "yaml";

import type { ModeFiles } from "./kit-copy.ts";

export type MemoryStoreVariant = "keeps every item" | "loses an item";

export const parrot = "parrot";

export const memoryStore = "memory-store";

export const forgetfulStore = "forgetful-store";

const sdkFromScripts = "../../../../bay/sdk.ts";

const testToolboxFromTests = "../../../../tests/test-toolbox.ts";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function lines(...texts: readonly string[]): string {
  return `${texts.join("\n")}\n`;
}

const parrotManifest = stringify({
  name: parrot,
  version: "1.0.0",
  description: "Says a text back twice; a made-up mode that a test adds to a copy of the kit.",
  actions: {
    repeat: {
      description: "When a test needs a text said back twice.",
      input: "schemas/repeat-request.json",
      output: "schemas/repeat-response.json",
      effects: ["read"],
      run: [{ script: "scripts/repeat.ts" }],
    },
  },
});

const textSchema = (title: string, description: string): string =>
  json({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title,
    description,
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string", description: "The text." } },
  });

export const parrotFiles: ModeFiles = {
  "mode.yaml": parrotManifest,
  "README.md": lines("# parrot", "", "Says a text back twice. A test adds it to a copy of the kit."),
  "schemas/repeat-request.json": textSchema("RepeatRequest", "The text to say back."),
  "schemas/repeat-response.json": textSchema("RepeatResponse", "The text, twice."),
  "scripts/repeat.ts": lines(
    `import { defineScript, fieldsOf } from "${sdkFromScripts}";`,
    "",
    "export const run = defineScript((input) => {",
    "  const text = fieldsOf(input).text;",
    '  return Promise.resolve({ text: typeof text === "string" ? `${text} ${text}` : "" });',
    "});",
  ),
  "tests/repeat.example.json": json({ input: { text: "hello" }, output: { text: "hello hello" } }),
  "tests/parrot.test.ts": lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `import { openModeProject } from "${testToolboxFromTests}";`,
    "",
    'test("parrot says the text back twice", async () => {',
    '  const project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["parrot"] });',
    "  try {",
    '    assert.deepEqual(await project.output("parrot.repeat", { text: "hello" }), { text: "hello hello" });',
    "  } finally {",
    "    await project.close();",
    "  }",
    "});",
  ),
};

const itemsStoreActions = {
  put: ["read", "write"],
  update: ["read", "write"],
  delete: ["read", "write", "delete"],
  get: ["read"],
  query: ["read"],
  sql: ["read"],
  prune: ["read", "write", "delete"],
  status: ["read"],
  allowance: ["read"],
} as const;

const note = {
  id: "local:a",
  kind: "note",
  source: "local",
  at: "2026-11-02T09:00:00Z",
  title: "A note",
  text: "Written by the owner.",
  url: null,
  author: null,
  labels: [],
  data: {},
};

const itemsStoreExamples: Readonly<Record<keyof typeof itemsStoreActions, unknown>> = {
  put: { input: { source: "local", kinds: ["note"], items: [note] }, output: { added: 1, updated: 0, skipped: [] } },
  update: { input: { id: "local:a", set: { text: "Changed." } }, output: { item: { ...note, text: "Changed." } } },
  delete: { input: { ids: ["local:a"] }, output: { deleted: ["local:a"], missing: [], remembered: [] } },
  get: { input: { ids: ["local:a"] }, output: { items: [note], missing: [] } },
  query: { input: {}, output: { items: [note], more: false } },
  sql: { input: { sql: "select id from items_view" }, output: { columns: ["id"], rows: [["local:a"]] } },
  prune: { input: { before: "2026-11-01T00:00:00Z" }, output: { removed: 0, remaining: 1 } },
  status: { input: {}, output: { items: 0, deletions: 0, sources: [] } },
  allowance: {
    input: { source: "fake" },
    output: { source: "fake", month: "2026-11", capUsd: null, spentUsd: 0, remainingUsd: null },
  },
};

const memorySettings = json({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "MemoryStoreSettings",
  description: "Settings of a made-up items store.",
  type: "object",
  additionalProperties: false,
  properties: {
    monthlyUsd: {
      type: "object",
      description: "The most US dollars a caller may spend on a source in one calendar month, by source name.",
      additionalProperties: { type: "number", minimum: 0, description: "Dollars per calendar month." },
    },
  },
});

const keptItemLine = "    items = [...items.filter((kept) => kept.id !== id), item];";

const lostItemLine = "    items = added === 1 ? items : [...items.filter((kept) => kept.id !== id), item];";

const memoryLibrary = String.raw`import {
  fail,
  fieldsOf,
  parseIsoTime,
  type Json,
  type JsonFields,
  type ScriptContext,
} from "../../../../../bay/sdk.ts";

type Spent = { readonly month: string; readonly items: number; readonly usd: number };

type Synced = {
  readonly source: string;
  readonly kinds: readonly string[];
  readonly cursor: Json;
  readonly lastSync: string;
  readonly selector: Json;
  readonly spent: readonly Spent[];
  readonly pages: readonly string[];
};

type Shelf = {
  readonly items: readonly JsonFields[];
  readonly deleted: readonly string[];
  readonly sources: readonly Synced[];
};

type Action = (input: JsonFields, shelf: Shelf, context: ScriptContext) => Json | Promise<Json>;

const emptyShelf: Shelf = { items: [], deleted: [], sources: [] };

const defaultLimit = 100;

const columns = ["id", "kind", "source", "at", "title", "text", "url", "author", "labels", "data"];

const itemsView =
  "items_view (" +
  columns.join(", ") +
  ") as (select " +
  columns.map((column) => "json_extract(value, '$." + column + "')").join(", ") +
  " from shelf, json_each(shelf.document, '$.items'))";

const saveShelf =
  "insert into shelf (id, document) values (1, :document) on conflict (id) do update set document = excluded.document";

function text(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function texts(value: Json | undefined): readonly string[] {
  return isList(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function list(value: Json | undefined): readonly JsonFields[] {
  return isList(value) ? value.map((entry) => fieldsOf(entry)) : [];
}

function count(value: Json | undefined): number {
  return typeof value === "number" ? value : 0;
}

function jsonOf(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => jsonOf(entry));
  }
  return typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonOf(entry)]))
    : null;
}

function syncedOf(fields: JsonFields): Synced {
  return {
    source: text(fields.source),
    kinds: texts(fields.kinds),
    cursor: fields.cursor ?? null,
    lastSync: text(fields.lastSync),
    selector: fields.selector ?? null,
    spent: list(fields.spent).map((entry) => ({
      month: text(entry.month),
      items: count(entry.items),
      usd: count(entry.usd),
    })),
    pages: texts(fields.pages),
  };
}

function shelfOf(document: Json | undefined): Shelf {
  if (typeof document !== "string") {
    return emptyShelf;
  }
  const fields = fieldsOf(jsonOf(JSON.parse(document)));
  return { items: list(fields.items), deleted: texts(fields.deleted), sources: list(fields.sources).map(syncedOf) };
}

function timeOf(value: Json | undefined): number {
  return parseIsoTime(text(value))?.getTime() ?? Number.NaN;
}

function monthOf(time: Date): string {
  return time.toISOString().slice(0, 7);
}

function dollars(usd: number): number {
  return Math.round(usd * 1e9) / 1e9;
}

function nameOf(name: string): string {
  return name.trim().toLowerCase().replace(/^@/, "");
}

function globOf(glob: string): RegExp {
  const parts = nameOf(glob)
    .split("*")
    .map((part) => part.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&"));
  return new RegExp("^" + parts.join(".*") + "$", "s");
}

function anyOf(wanted: readonly string[], test: (value: string) => boolean): boolean {
  return wanted.length === 0 || wanted.some(test);
}

function matches(selector: Json | undefined, item: JsonFields): boolean {
  const fields = fieldsOf(selector ?? {});
  const author = nameOf(text(item.author));
  const labels = texts(item.labels).map(nameOf);
  const body = (text(item.title) + "\n" + text(item.text)).toLowerCase();
  const at = timeOf(item.at);
  return (
    anyOf(texts(fields.kinds), (kind) => kind === item.kind) &&
    (fields.since === undefined || at >= timeOf(fields.since)) &&
    (fields.until === undefined || at < timeOf(fields.until)) &&
    anyOf(texts(fields.authors), (glob) => author !== "" && globOf(glob).test(author)) &&
    anyOf(texts(fields.labels), (label) => labels.includes(nameOf(label))) &&
    anyOf(texts(fields.text), (term) => body.includes(term.toLowerCase()))
  );
}

function wordsOf(value: string): readonly string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function holdsWords(search: string, item: JsonFields): boolean {
  const words = new Set(wordsOf(text(item.title) + " " + text(item.text) + " " + text(item.author)));
  return wordsOf(search).every((word) => words.has(word));
}

function newestFirst(left: JsonFields, right: JsonFields): number {
  return timeOf(right.at) - timeOf(left.at) || text(right.id).localeCompare(text(left.id));
}

function withItemsView(sql: string): string {
  const recursive = /^\s*with\s+recursive\s/i;
  const plain = /^\s*with\s/i;
  if (recursive.test(sql)) {
    return sql.replace(recursive, "with recursive " + itemsView + ", ");
  }
  return plain.test(sql) ? sql.replace(plain, "with " + itemsView + ", ") : "with " + itemsView + " " + sql;
}

function refusals(input: JsonFields, shelf: Shelf): readonly string[] {
  const source = text(input.source);
  const kinds = texts(input.kinds);
  const foreign = list(input.items).filter(
    (item) => item.source !== source || !text(item.id).startsWith(source + ":") || !kinds.includes(text(item.kind)),
  );
  const taken =
    source === "local"
      ? shelf.sources.filter((other) => other.source !== "local" && other.kinds.some((kind) => kinds.includes(kind)))
      : [];
  return [
    ...foreign.map((item) => text(item.id) + " does not belong to a put of " + source + "."),
    ...taken.map((other) => "The source " + other.source + " produces a kind of this local put."),
  ];
}

function pageOf(input: JsonFields, items: number, usd: number): string {
  return JSON.stringify([input.cursor ?? null, items, usd, list(input.items).map((item) => item.id ?? null)]);
}

function spendingAfter(input: JsonFields, synced: Synced | undefined, now: Date): Pick<Synced, "spent" | "pages"> {
  const spent = synced?.spent ?? [];
  const pages = synced?.pages ?? [];
  const cost = fieldsOf(input.cost ?? {});
  const items = count(cost.items);
  const usd = count(cost.usd);
  const page = pageOf(input, items, usd);
  if ((items === 0 && usd === 0) || pages.includes(page)) {
    return { spent, pages };
  }
  const month = monthOf(now);
  const earlier = spent.find((entry) => entry.month === month) ?? { month, items: 0, usd: 0 };
  const total = { month, items: earlier.items + items, usd: dollars(earlier.usd + usd) };
  return { spent: [...spent.filter((entry) => entry.month !== month), total], pages: [...pages, page] };
}

function skipReason(input: JsonFields, shelf: Shelf, item: JsonFields): string | undefined {
  const id = text(item.id);
  if (shelf.deleted.includes(id)) {
    return id + " was deleted, so it is not kept.";
  }
  if (input.selector !== undefined && !matches(input.selector, item)) {
    return id + " does not match its selector, so it is not kept.";
  }
  return undefined;
}

function stored(input: JsonFields, shelf: Shelf): { readonly items: readonly JsonFields[]; readonly output: Json } {
  let items = shelf.items;
  let added = 0;
  let updated = 0;
  const skipped: Json[] = [];
  for (const item of list(input.items)) {
    const id = text(item.id);
    const reason = skipReason(input, shelf, item);
    if (reason !== undefined) {
      skipped.push({ id, reason });
      continue;
    }
    const had = items.some((other) => other.id === id);
    items = [...items.filter((kept) => kept.id !== id), item];
    added += had ? 0 : 1;
    updated += had ? 1 : 0;
  }
  return { items, output: { added, updated, skipped } };
}

async function put(input: JsonFields, shelf: Shelf, context: ScriptContext): Promise<Json> {
  const refused = refusals(input, shelf);
  if (refused.length > 0) {
    return fail("Nothing was stored. " + refused.join(" "));
  }
  const source = text(input.source);
  const synced = shelf.sources.find((entry) => entry.source === source);
  const { items, output } = stored(input, shelf);
  const entry: Synced = {
    source,
    kinds: texts(input.kinds),
    cursor: Object.hasOwn(input, "cursor") ? (input.cursor ?? null) : (synced?.cursor ?? null),
    lastSync: context.now().toISOString(),
    selector: input.selector ?? synced?.selector ?? null,
    ...spendingAfter(input, synced, context.now()),
  };
  const sources = [...shelf.sources.filter((other) => other.source !== source), entry];
  await saved({ ...shelf, items, sources }, context);
  return output;
}

async function update(input: JsonFields, shelf: Shelf, context: ScriptContext): Promise<Json> {
  const id = text(input.id);
  const kept = shelf.items.find((item) => item.id === id);
  if (kept === undefined) {
    return fail("There is no item " + id + " to update.");
  }
  const item = { ...kept, ...fieldsOf(input.set ?? {}) };
  await saved({ ...shelf, items: shelf.items.map((other) => (other.id === id ? item : other)) }, context);
  return { item };
}

async function remove(input: JsonFields, shelf: Shelf, context: ScriptContext): Promise<Json> {
  const ids = texts(input.ids);
  const held = new Set(shelf.items.map((item) => text(item.id)));
  const remembered = ids.filter((id) => !id.startsWith("local:"));
  const items = shelf.items.filter((item) => !ids.includes(text(item.id)));
  await saved({ ...shelf, items, deleted: [...new Set([...shelf.deleted, ...remembered])] }, context);
  return { deleted: ids.filter((id) => held.has(id)), missing: ids.filter((id) => !held.has(id)), remembered };
}

function get(input: JsonFields, shelf: Shelf): Json {
  const ids = texts(input.ids);
  const items = ids.flatMap((id) => shelf.items.filter((item) => item.id === id));
  return { items, missing: ids.filter((id) => !shelf.items.some((item) => item.id === id)) };
}

function query(input: JsonFields, shelf: Shelf): Json {
  const search = input.search === undefined ? undefined : text(input.search);
  if (search !== undefined && wordsOf(search).length === 0) {
    return fail("The search " + JSON.stringify(search) + " has no word to look for.");
  }
  const limit = fieldsOf(input.selector ?? {}).limit;
  const most = typeof limit === "number" ? limit : defaultLimit;
  const newest = shelf.items
    .filter((item) => matches(input.selector, item) && (search === undefined || holdsWords(search, item)))
    .sort(newestFirst);
  const ordered = input.order === "oldest" ? newest.reverse() : newest;
  return { items: ordered.slice(0, most), more: ordered.length > most };
}

async function sql(input: JsonFields, _shelf: Shelf, context: ScriptContext): Promise<Json> {
  const answer = await context.db.partition(context.caller ?? "owner").agentQuery(withItemsView(text(input.sql)));
  return answer.ok ? { columns: answer.value.columns, rows: answer.value.rows } : fail(answer.message);
}

async function prune(input: JsonFields, shelf: Shelf, context: ScriptContext): Promise<Json> {
  const before = timeOf(input.before);
  const items = shelf.items.filter((item) => item.source === "local" || !(timeOf(item.at) < before));
  await saved({ ...shelf, items }, context);
  return { removed: shelf.items.length - items.length, remaining: items.length };
}

function status(_input: JsonFields, shelf: Shelf): Json {
  const sources = [...shelf.sources]
    .sort((left, right) => left.source.localeCompare(right.source))
    .map((synced) => ({
      source: synced.source,
      kinds: synced.kinds,
      items: shelf.items.filter((item) => item.source === synced.source).length,
      cursor: synced.cursor,
      lastSync: synced.lastSync,
      selector: synced.selector,
      spent: synced.spent,
    }));
  return { items: shelf.items.length, deletions: shelf.deleted.length, sources };
}

function allowance(input: JsonFields, shelf: Shelf, context: ScriptContext): Json {
  const source = text(input.source);
  const month = monthOf(context.now());
  const synced = shelf.sources.find((entry) => entry.source === source);
  const spentUsd = synced?.spent.find((entry) => entry.month === month)?.usd ?? 0;
  const cap = fieldsOf(context.settings.monthlyUsd ?? {})[source];
  const capUsd = typeof cap === "number" ? cap : null;
  return { source, month, capUsd, spentUsd, remainingUsd: capUsd === null ? null : dollars(capUsd - spentUsd) };
}

async function opened(context: ScriptContext): Promise<Shelf> {
  const partition = context.db.partition(context.caller ?? "owner");
  const migrated = await partition.migrate();
  if (!migrated.ok) {
    return fail(migrated.message);
  }
  const rows = await partition.query("select document from shelf where id = 1");
  return shelfOf(rows.ok ? rows.value[0]?.document : undefined);
}

async function saved(shelf: Shelf, context: ScriptContext): Promise<void> {
  const partition = context.db.partition(context.caller ?? "owner");
  const written = await partition.execute(saveShelf, { document: JSON.stringify(shelf) });
  if (!written.ok) {
    fail(written.message);
  }
}

const actions: Readonly<Record<string, Action>> = {
  put,
  update,
  delete: remove,
  get,
  query,
  sql,
  prune,
  status,
  allowance,
};

export async function answer(action: string, input: Json, context: ScriptContext): Promise<Json> {
  const run = actions[action];
  if (run === undefined) {
    return fail("memory-store has no action " + action + ".");
  }
  return run(fieldsOf(input), await opened(context), context);
}
`;

function memoryManifest(name: string): string {
  const actions = Object.entries(itemsStoreActions).map(([action, effects]): readonly [string, unknown] => [
    action,
    {
      description: `When a mode needs ${action} of items-store@1 from a made-up store that keeps items as one JSON document.`,
      effects,
      run: [{ script: `scripts/${action}.ts` }],
    },
  ]);
  return stringify({
    name,
    version: "1.0.0",
    description:
      "Keeps each caller's items as one JSON document; a made-up items-store@1 that a test adds to a copy of the kit.",
    implements: ["items-store@1"],
    resources: { db: { migrations: "migrations" } },
    settings: "schemas/settings.json",
    actions: Object.fromEntries(actions),
  });
}

function memoryScript(action: string): string {
  return lines(
    `import { defineScript } from "${sdkFromScripts}";`,
    'import { answer } from "./lib/memory.ts";',
    "",
    `export const run = defineScript((input, context) => answer("${action}", input, context));`,
  );
}

function memoryTest(name: string): string {
  return lines(
    'import { testItemsStore } from "../../../base/interfaces/items-store/tests/shared.ts";',
    "",
    `testItemsStore({ mode: "${name}" });`,
  );
}

export function memoryStoreFiles(name: string, variant: MemoryStoreVariant): ModeFiles {
  const library = variant === "keeps every item" ? memoryLibrary : memoryLibrary.replace(keptItemLine, lostItemLine);
  const scripts = Object.keys(itemsStoreActions).map((action): readonly [string, string] => [
    `scripts/${action}.ts`,
    memoryScript(action),
  ]);
  const examples = Object.entries(itemsStoreExamples).map(([action, example]): readonly [string, string] => [
    `tests/${action}.example.json`,
    json(example),
  ]);
  return {
    "mode.yaml": memoryManifest(name),
    "README.md": lines(
      `# ${name}`,
      "",
      "Keeps each caller's items as one JSON document. A test adds it to a copy of the kit.",
    ),
    "schemas/settings.json": memorySettings,
    "migrations/0001-shelf.sql": lines(
      "create table shelf (id integer primary key check (id = 1), document text not null);",
    ),
    "scripts/lib/memory.ts": library,
    ...Object.fromEntries(scripts),
    ...Object.fromEntries(examples),
    [`tests/${name}.test.ts`]: memoryTest(name),
  };
}
