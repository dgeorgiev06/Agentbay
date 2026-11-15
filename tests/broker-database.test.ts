import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { Broker } from "../bay/broker.ts";
import type { Effect, Permissions } from "../bay/contracts.ts";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, systemClock } from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  recordingSink,
  scriptedHttp,
  withProject,
  writeProjectFile,
} from "./broker-fixture.ts";

type Setup = { readonly root: string; readonly broker: Broker; readonly events: ReturnType<typeof recordingSink> };

function brokerFor(root: string, effects: readonly Effect[], extra: Partial<Permissions> = {}): Setup {
  const events = recordingSink();
  const broker = new Broker({
    root,
    permissions: permissionsIn(root, { effects, ...extra }),
    place,
    files: nodeFileSystem,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events,
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    limits: { agentQueryMilliseconds: 1500 },
  });
  return { root, broker, events };
}

async function withBroker(effects: readonly Effect[], run: (setup: Setup) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    const setup = brokerFor(root, effects);
    try {
      await run(setup);
    } finally {
      setup.broker.close();
    }
  });
}

function valueOf<T>(answer: Answer<T>): T {
  if (!answer.ok) {
    assert.fail(`expected a value, got: ${answer.message}`);
  }
  return answer.value;
}

function refusalOf<T>(answer: Answer<T>): string {
  assert.equal(answer.ok, false, "expected a refusal");
  assert.equal(answer.ok ? "" : answer.kind, "refused");
  return answer.ok ? "" : answer.message;
}

async function seedItems(broker: Broker, count: number): Promise<void> {
  valueOf(await broker.execute("create table items (id integer primary key, title text)"));
  valueOf(
    await broker.execute("insert into items (title) select 'item ' || value from json_each(?)", [
      JSON.stringify(Array.from({ length: count }, (_, index) => index)),
    ]),
  );
}

test("migrations run in order inside a transaction and are recorded once", async () => {
  await withBroker(["read", "write"], async ({ root, broker }) => {
    await writeProjectFile(root, "components/modes/notes/migrations/0002-add-index.sql", "create index t_x on t (x);");
    await writeProjectFile(root, "components/modes/notes/migrations/0001-create.sql", "create table t (x text);");
    assert.deepEqual(valueOf(await broker.migrate("migrations")), ["0001-create.sql", "0002-add-index.sql"]);
    assert.deepEqual(valueOf(await broker.migrate("migrations")), []);
    const recorded = valueOf(await broker.query("select name from _migrations order by name"));
    assert.deepEqual(recorded, [{ name: "0001-create.sql" }, { name: "0002-add-index.sql" }]);
    await writeProjectFile(root, "components/modes/notes/migrations/0003-good.sql", "create table u (y text);");
    await writeProjectFile(root, "components/modes/notes/migrations/0004-broken.sql", "create tabel v;");
    const broken = await broker.migrate("migrations");
    assert.equal(broken.ok, false);
    assert.match(broken.ok ? "" : broken.message, /0004-broken\.sql/);
    const tables = valueOf(await broker.query("select name from sqlite_schema where name = 'u'"));
    assert.deepEqual(tables, [], "the failed batch left nothing behind");
  });
});

test("a migrations folder outside the mode's folder is refused", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    refusalOf(await broker.migrate("../store/migrations"));
  });
});

test("a script with the write effect can execute and query its own database", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 3);
    const changed = valueOf(
      await broker.execute("update items set title = :title where id = :id", { title: "x", id: 2 }),
    );
    assert.equal(changed.changes, 1);
    assert.deepEqual(valueOf(await broker.query("select id, title from items where id = ?", [2])), [
      { id: 2, title: "x" },
    ]);
  });
});

test("a write statement from an action with only read effects is refused, naming the effects line", async () => {
  await withProject(async (root) => {
    const writer = brokerFor(root, ["read", "write"]);
    await seedItems(writer.broker, 1);
    writer.broker.close();
    const reader = brokerFor(root, ["read"]);
    try {
      for (const statement of [
        "insert into items (title) values ('x')",
        "delete from items",
        "with x as (select 1) insert into items (title) select * from x",
        "create table more (x)",
      ]) {
        const message = refusalOf(await reader.broker.execute(statement));
        assert.match(message, /action look/);
        assert.match(message, /actions\.look\.effects/);
      }
      assert.deepEqual(valueOf(await reader.broker.query("select count(*) as n from items")), [{ n: 1 }]);
      assert.equal(reader.events.events.filter((event) => event.kind === "refused").length, 4);
    } finally {
      reader.broker.close();
    }
  });
});

test("query never writes, even for an action with the write effect", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 1);
    refusalOf(await broker.query("insert into items (title) values ('x')"));
    refusalOf(await broker.query("delete from items"));
  });
});

test("another mode's database file is out of reach by attach, vacuum into, pragma and file reads", async () => {
  await withBroker(["read", "write"], async ({ root, broker }) => {
    await seedItems(broker, 1);
    const other = join(root, ".agentbay/data/store.db");
    for (const statement of [
      `attach '${other}' as other`,
      `vacuum into '${join(root, "copy.db")}'`,
      "pragma writable_schema = on",
      "select 1; attach 'x' as y",
    ]) {
      refusalOf(await broker.execute(statement));
      refusalOf(await broker.query(statement));
    }
    refusalOf(await broker.readFile(".agentbay/data/store.db"));
    refusalOf(await broker.readFile(".agentbay/data/notes.db"));
  });
});

test("an agent query returns rows, columns and full-text matches", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 3);
    valueOf(await broker.execute("create virtual table items_text using fts5 (title)"));
    valueOf(await broker.execute("insert into items_text (title) values ('an invoice'), ('a note')"));
    assert.deepEqual(valueOf(await broker.agentQuery("select id, title from items where id <= 2")), {
      columns: ["id", "title"],
      rows: [
        [1, "item 0"],
        [2, "item 1"],
      ],
    });
    const hits = valueOf(
      await broker.agentQuery("select count(*) as hits from items_text where items_text match 'invoice'"),
    );
    assert.deepEqual(hits.rows, [[1]]);
  });
});

const hostileAgentQueries: readonly (readonly [string, string])[] = [
  ["a second statement", "select 1; delete from items"],
  ["a second statement after closing the wrapper", "select 1) ; attach 'other.db' as y; select (1"],
  ["attach", "attach '/tmp/other.db' as other"],
  ["attach after closing the wrapper", "select 1) ; attach '/tmp/other.db' as other --"],
  ["a pragma write", "pragma user_version = 7"],
  ["turning query_only off", "pragma query_only = off"],
  ["insert", "insert into items (title) values ('x')"],
  ["with ... insert", "with x as (select 1) insert into items (title) select * from x"],
  ["create temp table", "create temp table t (x)"],
  ["load_extension", "select load_extension('/tmp/x.so')"],
  ["the outer-limit escape", "select * from items) limit 100000 --"],
  ["more rows than the limit", "select * from items"],
];

for (const [label, text] of hostileAgentQueries) {
  test(`an agent query is refused: ${label}`, async () => {
    await withBroker(["read", "write"], async ({ broker }) => {
      await seedItems(broker, 250);
      refusalOf(await broker.agentQuery(text));
      assert.deepEqual(valueOf(await broker.query("select count(*) as n from items")), [{ n: 250 }]);
    });
  });
}

test("an agent query with an endless recursive CTE is killed at the time limit, and the next query works", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 1);
    const started = Date.now();
    const message = refusalOf(
      await broker.agentQuery("with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r"),
    );
    const took = Date.now() - started;
    assert.match(message, /1500 ms/);
    assert.ok(took < 6000, `took ${String(took)} ms`);
    assert.deepEqual(valueOf(await broker.agentQuery("select count(*) as n from items")).rows, [[1]]);
  });
});

test("an agent query cuts long cells and redacts what it returns", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    valueOf(await broker.execute("create table notes (body text)"));
    valueOf(await broker.execute("insert into notes values (?), (?)", ["x".repeat(5000), "password=Hunter2.Secret!"]));
    const rows = valueOf(await broker.agentQuery("select body from notes")).rows;
    const first = rows[0]?.[0];
    assert.equal(typeof first, "string");
    assert.ok(typeof first === "string" && first.length < 4100 && first.includes("[cut 1000 characters"));
    assert.match(String(rows[1]?.[0]), /\[redacted:password\]/);
  });
});

test("an agent query against a mode with no database yet fails plainly", async () => {
  await withBroker(["read"], async ({ broker }) => {
    const answer = await broker.agentQuery("select 1");
    assert.equal(answer.ok ? "" : answer.kind, "failed");
    assert.match(answer.ok ? "" : answer.message, /no database yet/);
  });
});
