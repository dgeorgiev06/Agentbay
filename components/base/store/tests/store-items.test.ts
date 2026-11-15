import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/mode-harness.ts";
import { fieldsOf, listOf, textOf } from "../scripts/lib/json.ts";
import { putItems } from "../scripts/lib/put.ts";
import { upsertItem } from "../scripts/lib/statements.ts";

let project: ModeProject;

before(async () => {
  project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["store"] });
});

after(async () => {
  await project.close();
});

type ItemFields = {
  readonly id?: string;
  readonly kind?: string;
  readonly source?: string;
  readonly at?: string;
  readonly text?: string;
  readonly author?: string | null;
  readonly labels?: readonly string[];
};

function post(number: number, fields: ItemFields = {}): Json {
  return {
    id: `fake:${String(number)}`,
    kind: "post",
    source: "fake",
    at: `2026-11-0${String((number % 9) + 1)}T10:00:00Z`,
    title: null,
    text: `Post number ${String(number)} about staking.`,
    url: `https://fake.example/posts/${String(number)}`,
    author: "alice",
    labels: [],
    data: { likes: number },
    ...fields,
  };
}

function note(name: string, kind = "note"): Json {
  return {
    id: `local:${name}`,
    kind,
    source: "local",
    at: "2026-11-02T09:00:00Z",
    title: `Note ${name}`,
    text: "Written by the owner.",
    url: null,
    author: null,
    labels: [],
    data: {},
  };
}

function page(items: readonly Json[], extra: Readonly<Record<string, Json>> = {}): Json {
  return { source: "fake", kinds: ["post"], items, ...extra };
}

function field(value: Json, name: string): Json {
  return fieldsOf(value)[name] ?? null;
}

test("put then get returns the same items, in the order asked, and names the ids it does not hold", async () => {
  const caller = "round-trip";
  const items = [post(1), post(2, { labels: ["eth", "staking"], author: null })];
  assert.deepEqual(await project.output("store.put", page(items), { caller }), { added: 2, updated: 0, skipped: [] });
  const got = await project.output("store.get", { ids: ["fake:2", "fake:404", "fake:1"] }, { caller });
  assert.deepEqual(got, { items: [items[1] ?? null, items[0] ?? null], missing: ["fake:404"] });
});

test("put replaces an item with the same id instead of adding a second one", async () => {
  const caller = "upsert";
  await project.output("store.put", page([post(1)]), { caller });
  const changed = post(1, { text: "Edited at the source." });
  assert.deepEqual(await project.output("store.put", page([changed, post(2)]), { caller }), {
    added: 1,
    updated: 1,
    skipped: [],
  });
  assert.deepEqual(field(await project.output("store.get", { ids: ["fake:1"] }, { caller }), "items"), [changed]);
  assert.equal(field(await project.output("store.status", {}, { caller }), "items"), 2);
});

test("a deleted id is remembered and refused by every later put; a local id is not remembered", async () => {
  const caller = "deletions";
  await project.output("store.put", page([post(1), post(2)]), { caller });
  await project.output("store.put", { source: "local", kinds: ["note"], items: [note("a")] }, { caller });
  const deleted = await project.output("store.delete", { ids: ["fake:1", "local:a", "fake:9"] }, { caller });
  assert.deepEqual(deleted, {
    deleted: ["fake:1", "local:a"],
    missing: ["fake:9"],
    remembered: ["fake:1", "fake:9"],
  });
  for (const attempt of [1, 2]) {
    const again = await project.output("store.put", page([post(1), post(9), post(3)]), { caller });
    assert.equal(field(again, attempt === 1 ? "added" : "updated"), 1, `attempt ${String(attempt)}`);
    const skipped = listOf(field(again, "skipped"));
    assert.deepEqual(
      skipped.map((entry) => field(entry, "id")),
      ["fake:1", "fake:9"],
    );
    const reason = textOf(field(skipped[0] ?? null, "reason")) ?? "";
    assert.match(reason, /deleted from the store, so it is never stored again/);
  }
  assert.deepEqual(field(await project.output("store.get", { ids: ["fake:1"] }, { caller }), "missing"), ["fake:1"]);
  const local = await project.output("store.put", { source: "local", kinds: ["note"], items: [note("a")] }, { caller });
  assert.equal(field(local, "added"), 1);
});

test("put keeps only the items their selector matches, and says why it skipped the rest", async () => {
  const caller = "matched";
  const selector = { authors: ["alice"], text: ["staking"] };
  const items = [post(1), post(2, { author: "bob" }), post(3, { text: "Nothing relevant." })];
  const output = await project.output("store.put", page(items, { selector }), { caller });
  assert.equal(field(output, "added"), 1);
  const skipped = listOf(field(output, "skipped"));
  assert.deepEqual(
    skipped.map((entry) => field(entry, "id")),
    ["fake:2", "fake:3"],
  );
  assert.match(textOf(field(skipped[0] ?? null, "reason")) ?? "", /does not match the selector it was fetched with/);
  assert.equal(field(await project.output("store.status", {}, { caller }), "items"), 1);
});

test("put's matcher keeps an item at exactly since and drops one at exactly until, comparing zones", async () => {
  const caller = "matched-window";
  const selector = { since: "2026-11-02T10:00:00Z", until: "2026-11-04T10:00:00Z" };
  const items = [
    post(1, { at: "2026-11-02T12:00:00+02:00" }),
    post(2, { at: "2026-11-04T10:00:00Z" }),
    post(3, { at: "2026-11-02T09:59:59Z" }),
    post(4, { at: "2026-11-04T11:59:59+02:00" }),
  ];
  const output = await project.output("store.put", page(items, { selector }), { caller });
  assert.equal(field(output, "added"), 2);
  const skipped = listOf(field(output, "skipped")).map((entry) => field(entry, "id"));
  assert.deepEqual(skipped, ["fake:2", "fake:3"]);
});

test("put refuses an item of a kind its source does not produce, and stores nothing of that put", async () => {
  const caller = "kinds";
  const reason = await project.failure("store.put", page([post(1), post(2, { kind: "email" })]), { caller });
  assert.match(reason, /fake:2 is a email, which the source fake does not produce \(it produces: post\)/);
  assert.equal(field(await project.output("store.status", {}, { caller }), "items"), 0);
});

test("put refuses an item of another source or with an id of another source", async () => {
  const caller = "sources";
  const otherSource = await project.failure("store.put", page([post(1, { source: "x" })]), { caller });
  assert.match(otherSource, /has the source x, but this put is for fake/);
  const otherId = await project.failure("store.put", page([post(1, { id: "x:1" })]), { caller });
  assert.match(otherId, /does not start with fake:/);
});

test("a local item may not take a kind a source already produces in that store", async () => {
  const caller = "local-kinds";
  await project.output("store.put", page([post(1)]), { caller });
  const reason = await project.failure(
    "store.put",
    { source: "local", kinds: ["post"], items: [note("p", "post")] },
    { caller },
  );
  assert.match(reason, /A local item may not be a post: the source fake produces that kind/);
  const fine = await project.output("store.put", { source: "local", kinds: ["note"], items: [note("n")] }, { caller });
  assert.equal(field(fine, "added"), 1);
});

test("update changes the given fields of a local item and refuses an item from a source", async () => {
  const caller = "updates";
  await project.output("store.put", { source: "local", kinds: ["note"], items: [note("a")] }, { caller });
  const updated = await project.output(
    "store.update",
    { id: "local:a", set: { text: "Changed.", labels: ["later"] } },
    { caller },
  );
  assert.deepEqual(field(updated, "item"), { ...fieldsOf(note("a")), text: "Changed.", labels: ["later"] });
  const missing = await project.failure("store.update", { id: "local:b", set: { text: "x" } }, { caller });
  assert.match(missing, /There is no item local:b in the store to update/);
  const synced = await project.refusal("store.update", { id: "fake:1", set: { text: "x" } });
  assert.match(synced, /an item from a source is replaced by its next sync/);
});

test("prune drops source items before the time it is given and never the owner's local items", async () => {
  const caller = "prune";
  const old = post(1, { at: "2026-10-01T00:00:00Z" });
  const recent = post(2, { at: "2026-11-10T00:00:00Z" });
  await project.output("store.put", page([old, recent]), { caller });
  const oldNote = { ...fieldsOf(note("old")), at: "2025-01-01T00:00:00Z" };
  await project.output("store.put", { source: "local", kinds: ["note"], items: [oldNote] }, { caller });
  assert.deepEqual(await project.output("store.prune", { before: "2026-11-01T00:00:00Z" }, { caller }), {
    removed: 1,
    remaining: 2,
  });
  const got = await project.output("store.get", { ids: ["fake:1", "fake:2", "local:old"] }, { caller });
  assert.deepEqual(field(got, "missing"), ["fake:1"]);
});

test("prune compares times with their zones, not as text", async () => {
  const caller = "prune-zones";
  const early = post(1, { at: "2026-11-01T01:00:00+02:00" });
  const late = post(2, { at: "2026-10-31T23:30:00-02:00" });
  await project.output("store.put", page([early, late]), { caller });
  assert.deepEqual(await project.output("store.prune", { before: "2026-11-01T00:00:00Z" }, { caller }), {
    removed: 1,
    remaining: 1,
  });
  assert.deepEqual(field(await project.output("store.get", { ids: ["fake:1"] }, { caller }), "missing"), ["fake:1"]);
});

test("status reports counts, the cursor, the last sync, the selector and the spend of each source", async () => {
  const caller = "status";
  const selector = { authors: ["alice"] };
  const cost = { items: 2, usd: 0.25 };
  await project.output("store.put", page([post(1), post(2)], { cursor: "c-2", cost, selector }), { caller });
  await project.output("store.delete", { ids: ["fake:2"] }, { caller });
  const status = await project.output("store.status", {}, { caller });
  assert.equal(field(status, "items"), 1);
  assert.equal(field(status, "deletions"), 1);
  const sources = listOf(field(status, "sources"));
  assert.equal(sources.length, 1);
  const source = sources[0] ?? null;
  assert.equal(field(source, "cursor"), "c-2");
  assert.deepEqual(field(source, "selector"), selector);
  assert.match(textOf(field(source, "lastSync")) ?? "", /^\d{4}-\d{2}-\d{2}T/);
  const month = new Date().toISOString().slice(0, 7);
  assert.deepEqual(field(source, "spent"), [{ month, items: 2, usd: 0.25 }]);
  const later = await project.output("store.put", page([post(3)]), { caller });
  assert.equal(field(later, "added"), 1);
  const kept = listOf(field(await project.output("store.status", {}, { caller }), "sources"));
  assert.equal(field(kept[0] ?? null, "cursor"), "c-2");
  assert.deepEqual(field(kept[0] ?? null, "selector"), selector);
});

test("text that looks like a secret is not persisted, in the item or in the full-text index", async () => {
  const caller = "secrets";
  const leaky = post(1, { text: "Rotate it: password=Hunter2-made-up-99 before Friday." });
  await project.output("store.put", page([leaky]), { caller });
  const got = listOf(field(await project.output("store.get", { ids: ["fake:1"] }, { caller }), "items"));
  assert.equal(field(got[0] ?? null, "text"), "Rotate it: [redacted:password] before Friday.");
  const raw = await project.partition("store", caller).query("select text, data from items");
  assert.ok(raw.ok);
  assert.equal(JSON.stringify(raw.value).includes("Hunter2-made-up-99"), false);
  const searched = await project.output("store.query", { search: "Hunter2" }, { caller });
  assert.deepEqual(field(searched, "items"), []);
});

test("spend is recorded before the items, so a put that fails in between and is retried counts it once", async () => {
  const caller = "spend";
  const partition = project.partition("store", caller);
  assert.ok((await partition.migrate()).ok);
  let failNextInsert = true;
  const faulty = {
    query: partition.query,
    execute: async (sql: string, parameters?: Parameters<typeof partition.execute>[1]) => {
      if (sql === upsertItem && failNextInsert) {
        failNextInsert = false;
        return { ok: false as const, kind: "failed" as const, message: "the disk is full (injected)" };
      }
      return partition.execute(sql, parameters);
    },
  };
  const request = page([post(1), post(2)], { cursor: "c-2", cost: { items: 2, usd: 0.5 } });
  const now = new Date("2026-11-15T12:00:00Z");
  await assert.rejects(putItems(faulty, request, now), /the disk is full \(injected\)/);
  const spentOf = async (): Promise<Json> => {
    const rows = await partition.query("select month, items, usd from spend_by_month");
    assert.ok(rows.ok);
    return rows.value;
  };
  assert.deepEqual(await spentOf(), [{ month: "2026-11", items: 2, usd: 0.5 }]);
  const stateBefore = await partition.query("select cursor from sync_state");
  assert.ok(stateBefore.ok);
  assert.deepEqual(stateBefore.value, []);
  assert.deepEqual(await putItems(faulty, request, now), { added: 2, updated: 0, skipped: [] });
  assert.deepEqual(await spentOf(), [{ month: "2026-11", items: 2, usd: 0.5 }]);
  const nextPage = page([post(3)], { cursor: "c-3", cost: { items: 1, usd: 0.25 } });
  await putItems(faulty, nextPage, now);
  assert.deepEqual(await spentOf(), [{ month: "2026-11", items: 3, usd: 0.75 }]);
});
