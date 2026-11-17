import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { fieldsOf, listOf, textOf } from "../scripts/lib/json.ts";
import { putItems } from "../scripts/lib/put.ts";
import { upsertItem } from "../scripts/lib/statements.ts";

let project: ModeProject;

const config = { bindings: { "items-store": "store" }, adapter: "claude-code", modes: ["store"] };

const callers = ["wording", "half-costs", "secrets", "spend"];

before(async () => {
  project = await openModeProject(config, { callers });
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

test("the store says why it refused a put or an update, or skipped an item, in sentences of its own", async () => {
  const caller = "wording";
  await project.output("items-store.put", page([post(1), post(2)]), { caller });
  await project.output("items-store.delete", { ids: ["fake:1"] }, { caller });
  const again = await project.output("items-store.put", page([post(1)]), { caller });
  const deleted = textOf(field(listOf(field(again, "skipped"))[0] ?? null, "reason")) ?? "";
  assert.equal(deleted, "fake:1 was deleted from the store, so it is never stored again.");
  const selector = { authors: ["alice"] };
  const unmatched = await project.output("items-store.put", page([post(3, { author: "bob" })], { selector }), {
    caller,
  });
  const skipped = textOf(field(listOf(field(unmatched, "skipped"))[0] ?? null, "reason")) ?? "";
  assert.equal(skipped, "fake:3 does not match the selector it was fetched with, so it is not kept.");
  const kind = await project.failure("items-store.put", page([post(4, { kind: "email" })]), { caller });
  assert.match(kind, /fake:4 is a email, which the source fake does not produce \(it produces: post\)/);
  const otherSource = await project.failure("items-store.put", page([post(5, { source: "x" })]), { caller });
  assert.match(otherSource, /has the source x, but this put is for fake/);
  const otherId = await project.failure("items-store.put", page([post(5, { id: "x:5" })]), { caller });
  assert.match(otherId, /does not start with fake:/);
  const local = await project.failure(
    "items-store.put",
    { source: "local", kinds: ["post"], items: [note("p", "post")] },
    { caller },
  );
  assert.match(local, /A local item may not be a post: the source fake produces that kind/);
  const missing = await project.failure("items-store.update", { id: "local:b", set: { text: "x" } }, { caller });
  assert.match(missing, /There is no item local:b in the store to update/);
  const synced = await project.refusal("store.update", { id: "fake:1", set: { text: "x" } });
  assert.match(synced, /an item from a source is replaced by its next sync/);
});

test("a cost is recorded when only its items or only its dollars are zero, and not when both are", async () => {
  const caller = "half-costs";
  const month = new Date().toISOString().slice(0, 7);
  const spentOf = async (): Promise<Json> => {
    const sources = listOf(field(await project.output("items-store.status", {}, { caller }), "sources"));
    return field(sources[0] ?? null, "spent");
  };
  await project.output("items-store.put", page([post(1)], { cursor: "c-1", cost: { items: 0, usd: 0 } }), { caller });
  assert.deepEqual(await spentOf(), []);
  await project.output("items-store.put", page([post(2)], { cursor: "c-2", cost: { items: 0, usd: 0.5 } }), { caller });
  assert.deepEqual(await spentOf(), [{ month, items: 0, usd: 0.5 }]);
  await project.output("items-store.put", page([post(3)], { cursor: "c-3", cost: { items: 4, usd: 0 } }), { caller });
  assert.deepEqual(await spentOf(), [{ month, items: 4, usd: 0.5 }]);
});

test("text that looks like a secret is not persisted, in the item or in the full-text index", async () => {
  const caller = "secrets";
  const leaky = post(1, { text: "Rotate it: password=Hunter2-made-up-99 before Friday." });
  await project.output("items-store.put", page([leaky]), { caller });
  const got = listOf(field(await project.output("items-store.get", { ids: ["fake:1"] }, { caller }), "items"));
  assert.equal(field(got[0] ?? null, "text"), "Rotate it: [redacted:password] before Friday.");
  const raw = await project.partition("store", caller).query("select text, data from items");
  assert.ok(raw.ok);
  assert.equal(JSON.stringify(raw.value).includes("Hunter2-made-up-99"), false);
  const searched = await project.output("items-store.query", { search: "Hunter2" }, { caller });
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
