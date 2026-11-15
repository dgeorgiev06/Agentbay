import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { Broker } from "../bay/broker.ts";
import type { Effect } from "../bay/contracts.ts";
import { deletes, effectRefusal, type BrokerOperation } from "../bay/effect-rule.ts";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, systemClock } from "../bay/node-ports.ts";
import type { ChildProcesses, FileInspector, FileSystem, Http } from "../bay/ports.ts";
import { scriptCommand } from "../bay/script-runner.ts";
import { SecretStore } from "../bay/secrets.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingSink,
  scriptedHttp,
  withProject,
  writeProjectFile,
  type RecordingSink,
} from "./broker-fixture.ts";

type Ports = {
  readonly files: FileSystem;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly childProcesses: ChildProcesses;
  readonly secrets: SecretStore;
  readonly events: RecordingSink;
};

const broken = (): Promise<never> => Promise.reject(new Error("the port is broken"));

const brokenPorts = (): Ports => ({
  files: { readText: broken, list: broken, exists: broken, writeAtomic: broken },
  inspector: { realPath: broken, isLink: broken, entries: broken },
  http: { request: broken },
  childProcesses: {
    start: () => {
      throw new Error("no process can start");
    },
  },
  secrets: new SecretStore({ environment: {}, processes: { run: broken }, platform: "darwin" }),
  events: { events: [], append: broken },
});

const workingPorts = (): Ports => ({
  files: nodeFileSystem,
  inspector: nodeFileInspector,
  http: scriptedHttp(() => ({ status: 200, headers: {}, body: "fine" })),
  childProcesses: nodeChildProcesses,
  secrets: new SecretStore({
    environment: { AGENTBAY_SECRET_API_TOKEN: "made-up-token-for-effects" },
    processes: noProcesses,
    platform: "linux",
  }),
  events: recordingSink(),
});

function brokerWith(root: string, effects: readonly Effect[], ports: Ports): Broker {
  return new Broker({
    layout: projectLayout(root),
    permissions: permissionsIn(root, { effects, secrets: ["API_TOKEN"], hosts: ["api.example.com"] }),
    place,
    clock: systemClock,
    limits: { agentQueryMilliseconds: 1500 },
    ...ports,
  });
}

async function withBroker(
  effects: readonly Effect[],
  run: (broker: Broker, root: string, events: RecordingSink) => Promise<void>,
): Promise<void> {
  await withProject(async (root) => {
    await writeProjectFile(root, "components/modes/notes/migrations/0001-notes.sql", "create table notes (x text);\n");
    await writeProjectFile(root, "notes-in/today.md", "today");
    const ports = workingPorts();
    const broker = brokerWith(root, effects, ports);
    try {
      await run(broker, root, ports.events);
    } finally {
      broker.close();
    }
  });
}

function messageOf<T>(answer: Answer<T>): string {
  return answer.ok ? "" : answer.message;
}

function assertRefusedFor<T>(answer: Answer<T>, effect: Effect): void {
  assert.ok(!answer.ok && answer.kind === "refused", JSON.stringify(answer));
  assert.match(answer.message, new RegExp(`needs the ${effect} effect; to allow it, add ${effect} to actions.look`));
}

function assertNotRefusedForEffects<T>(answer: Answer<T>): void {
  assert.doesNotMatch(messageOf(answer), /effect; to allow it/);
}

test("files: a write needs write", async () => {
  await withBroker(["read"], async (broker, root) => {
    assertRefusedFor(await broker.writeFile("notes-out/a.txt", "x"), "write");
    assert.equal(existsSync(join(root, "notes-out", "a.txt")), false);
  });
  await withBroker(["read", "write"], async (broker, root) => {
    assert.deepEqual(await broker.writeFile("notes-out/a.txt", "x"), { ok: true, value: null });
    assert.equal(existsSync(join(root, "notes-out", "a.txt")), true);
  });
});

test("files: reading and listing need no effect", async () => {
  await withBroker([], async (broker) => {
    assert.deepEqual(await broker.readFile("notes-in/today.md"), { ok: true, value: "today" });
    assert.deepEqual(await broker.listFiles("notes-in"), { ok: true, value: ["today.md"] });
  });
});

test("db: a statement that changes data needs write", async () => {
  await withBroker(["read"], async (broker) => {
    assertRefusedFor(await broker.execute("insert into notes values ('a')"), "write");
    assertRefusedFor(await broker.execute("create table more (y)"), "write");
  });
  await withBroker(["read", "write"], async (broker) => {
    assert.ok((await broker.execute("insert into notes values ('a')")).ok);
  });
});

test("db: a statement that deletes needs delete as well as write", async () => {
  await withBroker(["read", "write"], async (broker) => {
    assertRefusedFor(await broker.execute("delete from notes"), "delete");
    assertRefusedFor(await broker.execute("drop table notes"), "delete");
    assertRefusedFor(await broker.execute("alter table notes drop column x"), "delete");
    assertRefusedFor(await broker.execute("with gone as (select 1) delete from notes"), "delete");
    assert.ok((await broker.execute("insert into notes values ('delete me; drop it')")).ok);
  });
  await withBroker(["read", "delete"], async (broker) => {
    assertRefusedFor(await broker.execute("delete from notes"), "write");
  });
  await withBroker(["read", "write", "delete"], async (broker) => {
    assert.ok((await broker.execute("insert into notes values ('a')")).ok);
    assert.deepEqual(await broker.execute("delete from notes"), {
      ok: true,
      value: { changes: 1, lastInsertRowid: 1 },
    });
  });
});

test("db: a write the leading word does not show is still refused without write, by the read-only connection", async () => {
  const hidden = "with source as (select 'a' as x) insert into notes select x from source";
  await withBroker(["read"], async (broker) => {
    const answer = await broker.execute(hidden);
    assert.ok(!answer.ok && answer.kind === "refused", JSON.stringify(answer));
    assert.match(answer.message, /to run a write statement/);
  });
  await withBroker(["read", "write"], async (broker) => {
    assert.ok((await broker.execute(hidden)).ok);
  });
});

test("db: queries, agent queries and migrations need no effect", async () => {
  await withBroker([], async (broker) => {
    assert.deepEqual(await broker.query("select count(*) as n from notes"), { ok: true, value: [{ n: 0 }] });
    assert.ok((await broker.agentQuery("select count(*) from notes")).ok);
    assert.deepEqual(await broker.migrate("other"), { ok: true, value: ["0001-notes.sql"] });
  });
});

test("http: a request needs network", async () => {
  await withBroker(["read"], async (broker) => {
    assertRefusedFor(await broker.request({ method: "GET", url: "https://api.example.com/x", headers: {} }), "network");
  });
  await withBroker(["read", "network"], async (broker) => {
    const answer = await broker.request({ method: "GET", url: "https://api.example.com/x", headers: {} });
    assert.deepEqual(answer, { ok: true, value: { status: 200, headers: {}, body: "fine" } });
  });
});

test("spend: a report of more than nothing needs spend; a report of nothing needs no effect", async () => {
  await withBroker(["read"], async (broker) => {
    assertRefusedFor(await broker.spend({ usd: 0.5 }), "spend");
    assertRefusedFor(await broker.spend({ items: 1 }), "spend");
    assert.deepEqual(await broker.spend({ items: 0, usd: 0 }), { ok: true, value: { items: 0, usd: 0, tokens: 0 } });
  });
  await withBroker(["read", "spend"], async (broker) => {
    assert.deepEqual(await broker.spend({ usd: 0.5 }), { ok: true, value: { items: 0, usd: 0.5, tokens: 0 } });
  });
});

test("secrets and events need no effect of their own", async () => {
  await withBroker([], async (broker, _root, events) => {
    assert.deepEqual(await broker.secret("API_TOKEN"), { ok: true, value: "made-up-token-for-effects" });
    assert.deepEqual(await broker.emit("noted", { a: 1 }), { ok: true, value: null });
    assert.ok(events.events.some((event) => event.kind === "noted"));
  });
});

test("a refusal by the effect rule is logged as a refused event, once", async () => {
  await withBroker(["read"], async (broker, _root, events) => {
    await broker.writeFile("notes-out/a.txt", "x");
    const refusals = events.events.filter((event) => event.kind === "refused");
    assert.equal(refusals.length, 1);
    assert.match(JSON.stringify(refusals[0]?.detail), /needs the write effect/);
  });
});

type MethodRow = {
  readonly call: (broker: Broker) => Promise<Answer<unknown>>;
  readonly needs: Effect | undefined;
  readonly usesPorts: boolean;
};

const brokerMethods: Readonly<Record<string, MethodRow>> = {
  migrate: { call: (broker) => broker.migrate(), needs: undefined, usesPorts: true },
  execute: { call: (broker) => broker.execute("insert into notes values (1)"), needs: "write", usesPorts: true },
  query: { call: (broker) => broker.query("select 1"), needs: undefined, usesPorts: true },
  agentQuery: { call: (broker) => broker.agentQuery("select 1"), needs: undefined, usesPorts: true },
  readFile: { call: (broker) => broker.readFile("notes-in/today.md"), needs: undefined, usesPorts: true },
  writeFile: { call: (broker) => broker.writeFile("notes-out/a.txt", "x"), needs: "write", usesPorts: true },
  listFiles: { call: (broker) => broker.listFiles("notes-in"), needs: undefined, usesPorts: true },
  secret: { call: (broker) => broker.secret("API_TOKEN"), needs: undefined, usesPorts: true },
  request: {
    call: (broker) => broker.request({ method: "GET", url: "https://api.example.com/x", headers: {} }),
    needs: "network",
    usesPorts: true,
  },
  emit: { call: (broker) => broker.emit("noted", {}), needs: undefined, usesPorts: true },
  spend: { call: (broker) => broker.spend({ usd: 1 }), needs: "spend", usesPorts: false },
};

const notResourceMethods: readonly string[] = ["constructor", "close", "report"];

test("every broker method that serves a resource is in the table of the one rule", () => {
  const methods = Object.getOwnPropertyNames(Broker.prototype).filter((name) => !notResourceMethods.includes(name));
  assert.deepEqual(methods.sort(), Object.keys(brokerMethods).sort());
});

test("every broker method passes through the one rule: refused without its effect, allowed with it", async () => {
  for (const row of Object.values(brokerMethods)) {
    await withBroker([], async (broker) => {
      const answer = await row.call(broker);
      if (row.needs === undefined) {
        assertNotRefusedForEffects(answer);
      } else {
        assertRefusedFor(answer, row.needs);
      }
    });
    const allowing: readonly Effect[] = row.needs === undefined ? [] : ["write", row.needs];
    await withBroker(allowing, async (broker) => {
      assertNotRefusedForEffects(await row.call(broker));
    });
  }
});

test("every broker method answers when every port throws, and never rejects", async () => {
  await withProject(async (root) => {
    for (const [name, row] of Object.entries(brokerMethods)) {
      const broker = brokerWith(root, ["read", "write", "delete", "network", "spend"], brokenPorts());
      try {
        const answer = await row.call(broker);
        if (row.usesPorts) {
          assert.ok(!answer.ok && answer.kind === "failed", `${name}: ${JSON.stringify(answer)}`);
          assert.match(answer.message, /(could not|failed).*: (the port is broken|no process can start)/, name);
        }
      } finally {
        broker.close();
      }
    }
  });
});

const operations: readonly (readonly [BrokerOperation, Effect | undefined])[] = [
  [{ kind: "db.migrate" }, undefined],
  [{ kind: "db.execute", sql: "update notes set x = 1" }, "write"],
  [{ kind: "db.execute", sql: "select 1" }, undefined],
  [{ kind: "db.query", sql: "select 'drop' as word" }, undefined],
  [{ kind: "db.query", sql: "with a as (select 1) delete from notes" }, "write"],
  [{ kind: "db.agentQuery" }, undefined],
  [{ kind: "files.read", path: "a" }, undefined],
  [{ kind: "files.list", path: "a" }, undefined],
  [{ kind: "files.write", path: "a" }, "write"],
  [{ kind: "secrets.get", name: "A" }, undefined],
  [{ kind: "http.request", method: "GET", url: "https://a.example" }, "network"],
  [{ kind: "events.emit", eventKind: "noted" }, undefined],
  [{ kind: "spend", amounts: { items: 0, usd: 0, tokens: 0 } }, undefined],
  [{ kind: "spend", amounts: { items: 0, usd: 0, tokens: 3 } }, "spend"],
];

test("the rule names the first missing effect for each kind of operation", () => {
  const at = { stepKey: "0", action: "look", manifest: "/m/mode.yaml" };
  for (const [operation, needed] of operations) {
    const refusal = effectRefusal(operation, [], at);
    assert.equal(refusal === undefined ? undefined : /add (\w+) to/.exec(refusal.change)?.[1], needed, operation.kind);
    assert.equal(effectRefusal(operation, ["read", "write", "delete", "network", "spend"], at), undefined);
  }
});

test("a statement deletes when a word outside quotes and comments is delete, drop or truncate", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["delete from items where id = 1", true],
    ["DROP TABLE items", true],
    ["alter table items drop column x", true],
    ["with old as (select id from items) delete from items where id in old", true],
    ["create trigger t after insert on a begin delete from b; end", true],
    ["truncate items", true],
    ["insert into items values ('delete')", false],
    ['select "drop" from items', false],
    ["select [delete] from items", false],
    ["select `truncate` from items", false],
    ["select 1 -- delete everything\n", false],
    ["select 1 /* drop */", false],
    ["insert into items values ('it''s a delete')", false],
    ["update items set deleted = 1", false],
    ["insert or replace into items values (1)", false],
  ];
  for (const [sql, expected] of cases) {
    assert.equal(deletes(sql), expected, sql);
  }
});

test("a script is granted direct file writes only when its action declares write", () => {
  const request = (effects: readonly Effect[]) => ({
    place,
    script: "scripts/a.ts",
    input: null,
    permissions: permissionsIn("/project", { writePaths: ["/project/out"], effects }),
    settings: {},
    remaining: {},
    timeLimitMilliseconds: 1000,
    call: () => Promise.reject(new Error("no calls")),
  });
  const writeGrants = (effects: readonly Effect[]): readonly string[] =>
    scriptCommand("/project/components/modes/notes/scripts/a.ts", request(effects)).filter((argument) =>
      argument.startsWith("--allow-fs-write"),
    );
  assert.deepEqual(writeGrants(["read"]), []);
  assert.deepEqual(writeGrants(["read", "write"]), [
    "--allow-fs-write=/project/out",
    "--allow-fs-write=/project/out/*",
  ]);
});
