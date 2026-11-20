import assert from "node:assert/strict";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { noInterfaceSchemas } from "./broker-fixture.ts";
import type { Answer } from "../bay/answers.ts";
import { createBroker, type StepBroker } from "../bay/broker/broker.ts";
import type { Effect, ModeGrants } from "../bay/contracts.ts";
import type { Child, ChildProcesses, ChildRequest } from "../bay/ports.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  failureOf,
  noProcesses,
  permissionsIn,
  place,
  recordingSink,
  refusalOf as refusal,
  scriptedHttp,
  valueOf,
  withProject,
  writeProjectFile,
  projectLayout,
} from "./broker-fixture.ts";

type Setup = { readonly root: string; readonly broker: StepBroker; readonly events: ReturnType<typeof recordingSink> };

type Started = {
  readonly request: ChildRequest;
  readonly child: Child;
};

type AgentQueries = {
  readonly milliseconds: number;
  readonly childProcesses: ChildProcesses;
};

const roomyAgentQueries: AgentQueries = { milliseconds: 120_000, childProcesses: nodeChildProcesses };

const agentQueryLimitMilliseconds = 1500;

function brokerFor(
  root: string,
  effects: readonly Effect[],
  extra: Partial<ModeGrants> = {},
  agentQueries: AgentQueries = roomyAgentQueries,
): Setup {
  const events = recordingSink();
  const broker = createBroker({
    layout: projectLayout(root),
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events,
    clock: systemClock,
    childProcesses: agentQueries.childProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
    interfaceSchemas: noInterfaceSchemas,
    limits: { agentQueryMilliseconds: agentQueries.milliseconds },
  }).forStep(place, permissionsIn(root, { effects, ...extra }));
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

function refusalOf<T>(answer: Answer<T>): string {
  return refusal(answer).message;
}

async function seedItems(broker: StepBroker, count: number): Promise<void> {
  valueOf(
    await broker.ask("db.execute", {
      sql: "create table items (id integer primary key, title text)",
      parameters: [],
    }),
  );
  valueOf(
    await broker.ask("db.execute", {
      sql: "insert into items (title) select 'item ' || value from json_each(?)",
      parameters: [JSON.stringify(Array.from({ length: count }, (_, index) => index))],
    }),
  );
}

test("migrations run in order inside a transaction and are recorded once", async () => {
  await withBroker(["read", "write"], async ({ root, broker }) => {
    await writeProjectFile(root, "components/modes/notes/migrations/0002-add-index.sql", "create index t_x on t (x);");
    await writeProjectFile(root, "components/modes/notes/migrations/0001-create.sql", "create table t (x text);");
    assert.deepEqual(valueOf(await broker.ask("db.migrate", {})), ["0001-create.sql", "0002-add-index.sql"]);
    assert.deepEqual(valueOf(await broker.ask("db.migrate", {})), []);
    const recorded = valueOf(
      await broker.ask("db.query", { sql: "select name from _migrations order by name", parameters: [] }),
    );
    assert.deepEqual(recorded, [{ name: "0001-create.sql" }, { name: "0002-add-index.sql" }]);
    await writeProjectFile(root, "components/modes/notes/migrations/0003-good.sql", "create table u (y text);");
    await writeProjectFile(root, "components/modes/notes/migrations/0004-broken.sql", "create tabel v;");
    assert.match(failureOf(await broker.ask("db.migrate", {})).message, /0004-broken\.sql/);
    const tables = valueOf(
      await broker.ask("db.query", { sql: "select name from sqlite_schema where name = 'u'", parameters: [] }),
    );
    assert.deepEqual(tables, [], "the failed batch left nothing behind");
  });
});

test("a migrations folder outside the mode's folder is refused", async () => {
  await withProject(async (root) => {
    const outside = join(root, "components/base/store/migrations");
    const { broker } = brokerFor(root, ["read", "write"], { migrationsFolder: outside });
    try {
      refusalOf(await broker.ask("db.migrate", {}));
    } finally {
      broker.close();
    }
  });
});

test("a script with the write effect can execute and query its own database", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 3);
    const changed = valueOf(
      await broker.ask("db.execute", {
        sql: "update items set title = :title where id = :id",
        parameters: { title: "x", id: 2 },
      }),
    );
    assert.equal(changed.changes, 1);
    assert.deepEqual(
      valueOf(await broker.ask("db.query", { sql: "select id, title from items where id = ?", parameters: [2] })),
      [{ id: 2, title: "x" }],
    );
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
        const message = refusalOf(await reader.broker.ask("db.execute", { sql: statement, parameters: [] }));
        assert.match(message, /action look/);
        assert.match(message, /actions\.look\.effects/);
      }
      assert.deepEqual(
        valueOf(await reader.broker.ask("db.query", { sql: "select count(*) as n from items", parameters: [] })),
        [{ n: 1 }],
      );
      assert.equal(reader.events.events.filter((event) => event.kind === "refused").length, 4);
    } finally {
      reader.broker.close();
    }
  });
});

test("query never writes, even for an action with the write effect", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 1);
    refusalOf(await broker.ask("db.query", { sql: "insert into items (title) values ('x')", parameters: [] }));
    refusalOf(await broker.ask("db.query", { sql: "delete from items", parameters: [] }));
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
      refusalOf(await broker.ask("db.execute", { sql: statement, parameters: [] }));
      refusalOf(await broker.ask("db.query", { sql: statement, parameters: [] }));
    }
    refusalOf(await broker.ask("files.read", { path: ".agentbay/data/store.db" }));
    refusalOf(await broker.ask("files.read", { path: ".agentbay/data/notes.db" }));
  });
});

test("an agent query returns rows, columns and full-text matches", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    await seedItems(broker, 3);
    valueOf(
      await broker.ask("db.execute", { sql: "create virtual table items_text using fts5 (title)", parameters: [] }),
    );
    valueOf(
      await broker.ask("db.execute", {
        sql: "insert into items_text (title) values ('an invoice'), ('a note')",
        parameters: [],
      }),
    );
    assert.deepEqual(valueOf(await broker.ask("db.agentQuery", { sql: "select id, title from items where id <= 2" })), {
      columns: ["id", "title"],
      rows: [
        [1, "item 0"],
        [2, "item 1"],
      ],
    });
    const hits = valueOf(
      await broker.ask("db.agentQuery", {
        sql: "select count(*) as hits from items_text where items_text match 'invoice'",
      }),
    );
    assert.deepEqual(hits.rows, [[1]]);
  });
});

const hostileAgentQueries: readonly (readonly [string, string, RegExp])[] = [
  ["a second statement", "select 1; delete from items", /near ";": syntax error/],
  ["a second statement after closing the wrapper", "select 1) ; attach 'other.db' as y; select (1", /more than one/],
  ["attach", "attach '/tmp/other.db' as other", /syntax error/],
  ["attach after closing the wrapper", "select 1) ; attach '/tmp/other.db' as other --", /more than one statement/],
  ["a pragma write", "pragma user_version = 7", /syntax error/],
  ["turning query_only off", "pragma query_only = off", /syntax error/],
  ["insert", "insert into items (title) values ('x')", /near "insert": syntax error/],
  ["with ... insert", "with x as (select 1) insert into items (title) select * from x", /near "insert"/],
  ["create temp table", "create temp table t (x)", /near "create": syntax error/],
  ["load_extension", "select load_extension('/tmp/x.so')", /not authorized/],
  ["the outer-limit escape", "select * from items) as x limit 100000 /*", /more than 200 rows/],
  ["the outer-limit escape with a line comment", "select * from items) limit 100000 --", /syntax error/],
  ["more rows than the limit", "select * from items", /more than 200 rows/],
];

for (const [label, text, reason] of hostileAgentQueries) {
  test(`an agent query is refused: ${label}`, async () => {
    await withBroker(["read", "write"], async ({ broker }) => {
      await seedItems(broker, 250);
      const message = refusalOf(await broker.ask("db.agentQuery", { sql: text }));
      assert.match(message, reason);
      assert.match(message, /every table is readable/);
      assert.deepEqual(
        valueOf(await broker.ask("db.query", { sql: "select count(*) as n from items", parameters: [] })),
        [{ n: 250 }],
      );
      assert.deepEqual(
        valueOf(await broker.ask("db.query", { sql: "select * from pragma_user_version", parameters: [] })),
        [{ user_version: 0 }],
      );
    });
  });
}

function isAgentQuery(started: Started): boolean {
  return started.request.arguments.some((word) => word.endsWith("query-child.ts"));
}

test("an agent query with an endless recursive CTE is killed at the time limit, and the next query works", async () => {
  await withProject(async (root) => {
    const started: Started[] = [];
    const limited = { milliseconds: agentQueryLimitMilliseconds, childProcesses: watchedChildProcesses(started) };
    const { broker } = brokerFor(root, ["read", "write"], {}, limited);
    try {
      await seedItems(broker, 1);
      const message = refusalOf(
        await broker.ask("db.agentQuery", {
          sql: "with recursive r(n) as (select 1 union all select n + 1 from r) select count(*) from r",
        }),
      );
      assert.match(message, /An agent's query was still running and was killed/);
      assert.match(message, /stop at the time limit of 1500 ms/);
      const queries = started.filter(isAgentQuery);
      assert.deepEqual(
        queries.map((query) => query.request.timeoutMilliseconds),
        [agentQueryLimitMilliseconds],
      );
      assert.deepEqual(await Promise.all(queries.map(async (query) => (await query.child.ended).how)), ["timed-out"]);
    } finally {
      broker.close();
    }
    const next = brokerFor(root, ["read"]);
    try {
      assert.deepEqual(
        valueOf(await next.broker.ask("db.agentQuery", { sql: "select count(*) as n from items" })).rows,
        [[1]],
      );
    } finally {
      next.broker.close();
    }
  });
});

test("an agent query redacts what it returns before it cuts long cells", async () => {
  await withBroker(["read", "write"], async ({ broker }) => {
    valueOf(await broker.ask("db.execute", { sql: "create table notes (body text)", parameters: [] }));
    valueOf(
      await broker.ask("db.execute", {
        sql: "insert into notes values (?), (?)",
        parameters: ["x".repeat(5000), "password=Hunter2.Secret!"],
      }),
    );
    const rows = valueOf(await broker.ask("db.agentQuery", { sql: "select body from notes" })).rows;
    const first = rows[0]?.[0];
    assert.equal(typeof first, "string");
    assert.ok(typeof first === "string" && first.length < 4100 && first.includes("[cut 1000 characters"));
    assert.match(JSON.stringify(rows[1]?.[0]), /\[redacted:password\]/);
    valueOf(
      await broker.ask("db.execute", {
        sql: "insert into notes values (?)",
        parameters: [`${"y".repeat(3990)} sk-ant-api03-${"a".repeat(40)}`],
      }),
    );
    const straddling = valueOf(
      await broker.ask("db.agentQuery", { sql: "select body from notes where body like 'yyy%'" }),
    ).rows;
    assert.doesNotMatch(JSON.stringify(straddling), /sk-ant/);
  });
});

function ownerOnlyFile(file: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, "a", 0o600));
}

test("an agent query waits while another connection holds the partition, then answers", async () => {
  await withBroker(["read"], async ({ root, broker }) => {
    const file = join(root, ".agentbay", "data", "notes--kept.db");
    ownerOnlyFile(file);
    const holder = new DatabaseSync(file);
    holder.exec("begin exclusive");
    holder.exec("create table items (title text)");
    setTimeout(() => {
      holder.exec("commit");
      holder.close();
    }, 500);
    const counted = await broker.ask("db.agentQuery", {
      sql: "select count(*) as items from items",
      partition: "kept",
    });
    assert.deepEqual(valueOf(counted), { columns: ["items"], rows: [[0]] });
  });
});

test("an agent query against a mode with no database yet fails plainly", async () => {
  await withBroker(["read"], async ({ broker }) => {
    assert.match(failureOf(await broker.ask("db.agentQuery", { sql: "select 1" })).message, /no database yet/);
  });
});

function watchedChildProcesses(started: Started[]): ChildProcesses {
  return {
    start: (request, onLine) => {
      const child = nodeChildProcesses.start(request, onLine);
      started.push({ request, child });
      return child;
    },
  };
}

async function endWithin(child: Child, milliseconds: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const waited = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      resolve("still running");
    }, milliseconds);
  });
  try {
    return await Promise.race([child.ended.then((end) => end.how), waited]);
  } finally {
    clearTimeout(timer);
  }
}

test("closing a step's broker ends the database processes it opened", async () => {
  await withProject(async (root) => {
    const started: Started[] = [];
    const broker = createBroker({
      layout: projectLayout(root),
      files: nodeFileSystem,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events: recordingSink(),
      clock: systemClock,
      childProcesses: watchedChildProcesses(started),
      processes: noProcesses,
      commandSearchPath: "/usr/bin:/bin",
      interfaceSchemas: noInterfaceSchemas,
    }).forStep(place, permissionsIn(root, { effects: ["read", "write"] }));
    try {
      valueOf(await broker.ask("db.execute", { sql: "create table notes (title text)", parameters: [] }));
      valueOf(await broker.ask("db.query", { sql: "select count(*) as notes from notes", parameters: [] }));
      assert.equal(started.length, 1);
      broker.close();
      assert.deepEqual(await Promise.all(started.map(({ child }) => endWithin(child, 5000))), ["signalled"]);
    } finally {
      broker.close();
      for (const { child } of started) {
        child.kill();
      }
    }
  });
});
