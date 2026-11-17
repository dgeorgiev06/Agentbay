import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { brokerForStep, type StepBroker } from "../bay/broker/broker.ts";
import type { Effect } from "../bay/contracts.ts";
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
  projectLayout,
  recordingSink,
  refusalOf,
  scriptedHttp,
  valueOf,
  withProject,
  writeProjectFile,
} from "./broker-fixture.ts";

type Setup = { readonly root: string; readonly broker: StepBroker; readonly events: ReturnType<typeof recordingSink> };

function brokerFor(root: string, effects: readonly Effect[]): Setup {
  const events = recordingSink();
  const broker = brokerForStep({
    layout: projectLayout(root),
    permissions: permissionsIn(root, { effects }),
    place,
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events,
    clock: systemClock,
    childProcesses: nodeChildProcesses,
    processes: noProcesses,
    commandSearchPath: "/usr/bin:/bin",
    limits: { agentQueryMilliseconds: 1500 },
  });
  return { root, broker, events };
}

async function withMigrations(run: (setup: Setup) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/migrations/0001-notes.sql", "create table notes (text text);");
    const setup = brokerFor(root, ["read", "write"]);
    try {
      await run(setup);
    } finally {
      setup.broker.close();
    }
  });
}

test("a partition is its own file, named <mode>--<name>.db, beside the unnamed database", async () => {
  await withMigrations(async ({ root, broker }) => {
    assert.deepEqual(valueOf(await broker.entries["db.migrate"]({ partition: "alpha" })), ["0001-notes.sql"]);
    assert.ok(existsSync(join(root, ".agentbay", "data", "notes--alpha.db")));
    assert.equal(existsSync(join(root, ".agentbay", "data", "notes.db")), false);
    valueOf(
      await broker.entries["db.execute"]({
        sql: "insert into notes (text) values (?)",
        parameters: ["kept in alpha"],
        partition: "alpha",
      }),
    );
    assert.deepEqual(
      valueOf(await broker.entries["db.query"]({ sql: "select text from notes", parameters: [], partition: "alpha" })),
      [{ text: "kept in alpha" }],
    );
  });
});

test("migrations are tracked per partition file, and the unnamed database is migrated on its own", async () => {
  await withMigrations(async ({ root, broker }) => {
    assert.deepEqual(valueOf(await broker.entries["db.migrate"]({ partition: "alpha" })), ["0001-notes.sql"]);
    assert.deepEqual(valueOf(await broker.entries["db.migrate"]({ partition: "alpha" })), []);
    assert.deepEqual(valueOf(await broker.entries["db.migrate"]({ partition: "beta" })), ["0001-notes.sql"]);
    assert.deepEqual(valueOf(await broker.entries["db.migrate"]({})), ["0001-notes.sql"]);
    assert.ok(existsSync(join(root, ".agentbay", "data", "notes.db")));
  });
});

test("two partitions do not see each other's tables or rows", async () => {
  await withMigrations(async ({ broker }) => {
    valueOf(await broker.entries["db.migrate"]({ partition: "alpha" }));
    valueOf(await broker.entries["db.migrate"]({ partition: "beta" }));
    valueOf(
      await broker.entries["db.execute"]({
        sql: "create table only_alpha (x text)",
        parameters: [],
        partition: "alpha",
      }),
    );
    valueOf(
      await broker.entries["db.execute"]({
        sql: "insert into notes (text) values ('alpha note')",
        parameters: [],
        partition: "alpha",
      }),
    );
    assert.deepEqual(
      valueOf(await broker.entries["db.query"]({ sql: "select text from notes", parameters: [], partition: "beta" })),
      [],
    );
    assert.match(
      failureOf(
        await broker.entries["db.query"]({ sql: "select x from only_alpha", parameters: [], partition: "beta" }),
      ).message,
      /no such table/,
    );
    assert.match(
      failureOf(await broker.entries["db.query"]({ sql: "select x from only_alpha", parameters: [] })).message,
      /no database|no such table/,
    );
  });
});

test("a partition name that is not kebab-case is refused before any file is touched", async () => {
  await withMigrations(async ({ root, broker, events }) => {
    const names = ["../escape", "a.b", "a/b", "Alpha", "", "a--b", "-a", "a-", "x".repeat(65), "with space"];
    for (const name of names) {
      const refusal = refusalOf(
        await broker.entries["db.execute"]({ sql: "create table t (x text)", parameters: [], partition: name }),
      );
      assert.match(refusal.declared, /kebab-case/, name);
      refusalOf(await broker.entries["db.migrate"]({ partition: name }));
      refusalOf(await broker.entries["db.query"]({ sql: "select 1", parameters: [], partition: name }));
      refusalOf(await broker.entries["db.agentQuery"]({ sql: "select 1", partition: name }));
    }
    const dataFolder = join(root, ".agentbay", "data");
    assert.equal(existsSync(dataFolder), false);
    assert.ok(events.events.some((event) => event.kind === "refused"));
  });
});

test("an agent query on one partition cannot attach another partition or read its rows", async () => {
  await withMigrations(async ({ root, broker }) => {
    valueOf(await broker.entries["db.migrate"]({ partition: "alpha" }));
    valueOf(await broker.entries["db.migrate"]({ partition: "beta" }));
    valueOf(
      await broker.entries["db.execute"]({
        sql: "insert into notes (text) values ('secret plans of beta')",
        parameters: [],
        partition: "beta",
      }),
    );
    const betaFile = join(root, ".agentbay", "data", "notes--beta.db");
    const attach = await broker.entries["db.agentQuery"]({
      sql: `attach database '${betaFile}' as other`,
      partition: "alpha",
    });
    assert.equal(attach.ok, false);
    const joined = await broker.entries["db.agentQuery"]({ sql: `select * from other.notes`, partition: "alpha" });
    assert.equal(joined.ok, false);
    const own = valueOf(
      await broker.entries["db.agentQuery"]({ sql: "select count(*) as n from notes", partition: "alpha" }),
    );
    assert.deepEqual(own.rows, [[0]]);
    const theirs = valueOf(await broker.entries["db.agentQuery"]({ sql: "select text from notes", partition: "beta" }));
    assert.deepEqual(theirs.rows, [["secret plans of beta"]]);
  });
});

test("an agent query on a partition that was never migrated fails plainly", async () => {
  await withMigrations(async ({ broker }) => {
    assert.match(
      failureOf(await broker.entries["db.agentQuery"]({ sql: "select 1", partition: "gamma" })).message,
      /no database yet/,
    );
  });
});

test("text that looks like a secret is redacted from statement values before it is stored", async () => {
  await withMigrations(async ({ broker, events }) => {
    valueOf(await broker.entries["db.migrate"]({ partition: "alpha" }));
    const leaked = "deploy with api_key=Zx9-made-up-key-0042 tonight";
    valueOf(
      await broker.entries["db.execute"]({
        sql: "insert into notes (text) values (?)",
        parameters: [leaked],
        partition: "alpha",
      }),
    );
    valueOf(
      await broker.entries["db.execute"]({
        sql: "insert into notes (text) values (:text)",
        parameters: { text: "no secret here" },
        partition: "alpha",
      }),
    );
    const rows = valueOf(
      await broker.entries["db.query"]({
        sql: "select text from notes order by rowid",
        parameters: [],
        partition: "alpha",
      }),
    );
    assert.deepEqual(rows, [{ text: "deploy with [redacted:secret-assignment] tonight" }, { text: "no secret here" }]);
    const redacted = events.events.filter((event) => event.kind === "redacted");
    assert.equal(redacted.length, 1);
    assert.equal(JSON.stringify(redacted).includes("Zx9-made-up-key-0042"), false);
  });
});
