import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { fieldsOf } from "../scripts/lib/json.ts";

let project: ModeProject;

function postsOf(source: string, count: number): Json {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `${source}:${String(index + 1)}`,
    kind: "post",
    source,
    at: `2026-11-01T10:${String(index % 60).padStart(2, "0")}:00Z`,
    title: null,
    text: `Post ${String(index + 1)} from ${source}.`,
    url: null,
    author: `${source}-author`,
    labels: [],
    data: {},
  }));
  return { source, kinds: ["post"], items };
}

before(async () => {
  project = await openModeProject(
    { bindings: { "items-store": "store" }, adapter: "claude-code", modes: ["store"] },
    { callers: ["mail-briefing", "todo"] },
  );
  await project.output("items-store.put", postsOf("fake", 3), { caller: "mail-briefing" });
  await project.output("items-store.put", postsOf("other", 250), { caller: "todo" });
});

after(async () => {
  await project.close();
});

async function sql(text: string, caller = "mail-briefing"): Promise<Json> {
  return project.output("items-store.sql", { sql: text }, { caller });
}

test("items_search is the full-text index of the caller's items, joined to items on rowid", async () => {
  const searched = await sql(
    "select items.id from items_search join items on items.rowid = items_search.rowid " +
      "where items_search match 'post' order by items.id limit 2",
  );
  assert.deepEqual(fieldsOf(searched).rows, [["fake:1"], ["fake:2"]]);
});

test("an agent's query that is refused says so, for a write to the store's own tables and for a pragma too", async () => {
  const refused = [
    "select 1; select 2",
    "delete from items",
    "insert into deletions (id, deleted_at) values ('fake:1', 'now')",
    "attach database 'x.db' as other",
    "pragma query_only = off",
  ];
  for (const text of refused) {
    const reason = await project.failure("items-store.sql", { sql: text }, { caller: "mail-briefing" });
    assert.match(reason, /^An agent.s query was refused/, text);
  }
  assert.deepEqual(fieldsOf(await sql("select count(*) from items")).rows, [[3]]);
});

test("sql refuses more rows than its limit and stops a runaway query", async () => {
  const many = await project.failure("items-store.sql", { sql: "select id from items" }, { caller: "todo" });
  assert.match(many, /more than 200 rows/);
  const endless = "with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r";
  const started = Date.now();
  const stopped = await project.failure("items-store.sql", { sql: endless }, { caller: "todo" });
  assert.match(stopped, /still running and was killed/);
  assert.ok(Date.now() - started < 15_000);
  assert.deepEqual(fieldsOf(await sql("select count(*) from items", "todo")).rows, [[250]]);
});

test("one caller cannot attach another caller's database file, nor see it listed", async () => {
  const otherFile = join(project.root, ".agentbay", "data", "store--todo.db");
  const attach = await project.failure(
    "items-store.sql",
    { sql: `attach '${otherFile}' as todo` },
    { caller: "mail-briefing" },
  );
  assert.match(attach, /refused/);
  const listed = await sql("select file from pragma_database_list");
  assert.equal(JSON.stringify(listed).includes("store--todo.db"), false);
});

test("a direct call with no caller uses the owner's own partition", async () => {
  await project.output("store.put", postsOf("fake", 1), {});
  assert.deepEqual(fieldsOf(await project.output("store.status", {}, {})).items, 1);
  const mail = await project.output("items-store.status", {}, { caller: "mail-briefing" });
  assert.equal(fieldsOf(mail).items, 3);
  const files = await project.partition("store", "owner").query("select count(*) as n from items");
  assert.ok(files.ok);
  assert.deepEqual(files.value, [{ n: 1 }]);
});

test("the store writes only database files: one partition per caller, and no unnamed database it never uses", () => {
  const files = readdirSync(join(project.root, ".agentbay", "data")).filter((name) => !/-(wal|shm)$/.test(name));
  assert.deepEqual(files.sort(), ["store--mail-briefing.db", "store--owner.db", "store--todo.db"]);
});
