import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { noInterfaceSchemas } from "./broker-fixture.ts";
import type { Answer } from "../bay/answers.ts";
import { createBroker, type StepBroker } from "../bay/broker/broker.ts";
import type { Effect } from "../bay/contracts.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeProcesses,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import type { ChildProcesses, FileInspector, FileSystem, Http, Processes, ThrowawayFolders } from "../bay/ports.ts";
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
import { grantedCommand } from "./grants-fixture.ts";

type Ports = {
  readonly files: FileSystem;
  readonly throwawayFolders: ThrowawayFolders;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly childProcesses: ChildProcesses;
  readonly processes: Processes;
  readonly secrets: SecretStore;
  readonly events: RecordingSink;
};

const broken = (): Promise<never> => Promise.reject(new Error("the port is broken"));

const brokenPorts = (): Ports => ({
  files: {
    readText: broken,
    list: broken,
    exists: broken,
    writeAtomic: broken,
  },
  throwawayFolders: { makeFolder: broken, link: broken, removeAll: broken },
  inspector: { realPath: broken, isLink: broken, entries: broken },
  http: { request: broken },
  childProcesses: {
    start: () => {
      throw new Error("no process can start");
    },
  },
  processes: { run: broken },
  secrets: new SecretStore({ environment: {}, processes: { run: broken }, platform: "darwin" }),
  events: { events: [], append: broken },
});

const workingPorts = (): Ports => ({
  files: nodeFileSystem,
  throwawayFolders: nodeThrowawayFolders,
  inspector: nodeFileInspector,
  http: scriptedHttp(() => ({ status: 200, headers: {}, body: "fine" })),
  childProcesses: nodeChildProcesses,
  processes: nodeProcesses,
  secrets: new SecretStore({
    environment: { AGENTBAY_SECRET_API_TOKEN: "made-up-token-for-effects" },
    processes: noProcesses,
    platform: "linux",
  }),
  events: recordingSink(),
});

function brokerWith(root: string, effects: readonly Effect[], ports: Ports): StepBroker {
  return createBroker({
    layout: projectLayout(root),
    clock: systemClock,
    commandSearchPath: process.env.PATH ?? "/usr/bin:/bin",
    interfaceSchemas: noInterfaceSchemas,
    limits: { agentQueryMilliseconds: 1500 },
    ...ports,
  }).forStep(
    place,
    permissionsIn(root, {
      effects,
      secrets: ["API_TOKEN"],
      hosts: ["api.example.com"],
      commands: [grantedCommand("version", "node --version")],
      throwawayPaths: [join(root, "scratch")],
    }),
  );
}

async function withBroker(
  effects: readonly Effect[],
  run: (broker: StepBroker, root: string, events: RecordingSink) => Promise<void>,
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
  const needs = `(needs the ${effect} effect; to allow it|is listed with: [a-z, ]+\\. To allow it)`;
  assert.match(answer.message, new RegExp(`${needs}, add ${effect} to actions.look`));
}

function assertNotRefusedForEffects<T>(answer: Answer<T>): void {
  assert.doesNotMatch(messageOf(answer), /effect; to allow it|is listed with: /);
}

test("files: a write needs write", async () => {
  await withBroker(["read"], async (broker, root) => {
    assertRefusedFor(await broker.ask("files.write", { path: "notes-out/a.txt", text: "x" }), "write");
    assert.equal(existsSync(join(root, "notes-out", "a.txt")), false);
  });
  await withBroker(["read", "write"], async (broker, root) => {
    assert.deepEqual(await broker.ask("files.write", { path: "notes-out/a.txt", text: "x" }), {
      ok: true,
      value: null,
    });
    assert.equal(existsSync(join(root, "notes-out", "a.txt")), true);
  });
});

test("files: reading and listing need no effect", async () => {
  await withBroker([], async (broker) => {
    assert.deepEqual(await broker.ask("files.read", { path: "notes-in/today.md" }), { ok: true, value: "today" });
    assert.deepEqual(await broker.ask("files.list", { path: "notes-in" }), { ok: true, value: ["today.md"] });
  });
});

test("db: a statement that changes data needs write", async () => {
  await withBroker(["read"], async (broker) => {
    assertRefusedFor(
      await broker.ask("db.execute", { sql: "insert into notes values ('a')", parameters: [] }),
      "write",
    );
    assertRefusedFor(await broker.ask("db.execute", { sql: "create table more (y)", parameters: [] }), "write");
  });
  await withBroker(["read", "write"], async (broker) => {
    assert.ok((await broker.ask("db.execute", { sql: "insert into notes values ('a')", parameters: [] })).ok);
  });
});

test("db: a statement that deletes needs delete as well as write", async () => {
  await withBroker(["read", "write"], async (broker) => {
    assertRefusedFor(await broker.ask("db.execute", { sql: "delete from notes", parameters: [] }), "delete");
    assertRefusedFor(await broker.ask("db.execute", { sql: "drop table notes", parameters: [] }), "delete");
    assertRefusedFor(
      await broker.ask("db.execute", { sql: "alter table notes drop column x", parameters: [] }),
      "delete",
    );
    assertRefusedFor(
      await broker.ask("db.execute", { sql: "with gone as (select 1) delete from notes", parameters: [] }),
      "delete",
    );
    assert.ok(
      (await broker.ask("db.execute", { sql: "insert into notes values ('delete me; drop it')", parameters: [] })).ok,
    );
  });
  await withBroker(["read", "delete"], async (broker) => {
    assertRefusedFor(await broker.ask("db.execute", { sql: "delete from notes", parameters: [] }), "write");
  });
  await withBroker(["read", "write", "delete"], async (broker) => {
    assert.ok((await broker.ask("db.execute", { sql: "insert into notes values ('a')", parameters: [] })).ok);
    assert.deepEqual(await broker.ask("db.execute", { sql: "delete from notes", parameters: [] }), {
      ok: true,
      value: { changes: 1, lastInsertRowid: 1 },
    });
  });
});

test("db: a write the leading word does not show is still refused without write, by the read-only connection", async () => {
  const hidden = "with source as (select 'a' as x) insert into notes select x from source";
  await withBroker(["read"], async (broker) => {
    const answer = await broker.ask("db.execute", { sql: hidden, parameters: [] });
    assert.ok(!answer.ok && answer.kind === "refused", JSON.stringify(answer));
    assert.match(answer.message, /to run a write statement/);
  });
  await withBroker(["read", "write"], async (broker) => {
    assert.ok((await broker.ask("db.execute", { sql: hidden, parameters: [] })).ok);
  });
});

test("db: queries, agent queries and migrations need no effect", async () => {
  await withBroker([], async (broker) => {
    assert.deepEqual(await broker.ask("db.query", { sql: "select count(*) as n from notes", parameters: [] }), {
      ok: true,
      value: [{ n: 0 }],
    });
    assert.ok((await broker.ask("db.agentQuery", { sql: "select count(*) from notes" })).ok);
    assert.deepEqual(await broker.ask("db.migrate", { partition: "other" }), {
      ok: true,
      value: ["0001-notes.sql"],
    });
  });
});

test("http: a request needs network", async () => {
  await withBroker(["read"], async (broker) => {
    assertRefusedFor(
      await broker.ask("http.request", { method: "GET", url: "https://api.example.com/x", headers: {} }),
      "network",
    );
  });
  await withBroker(["read", "network"], async (broker) => {
    const answer = await broker.ask("http.request", {
      method: "GET",
      url: "https://api.example.com/x",
      headers: {},
    });
    assert.deepEqual(answer, { ok: true, value: { status: 200, headers: {}, body: "fine" } });
  });
});

test("secrets and events need no effect of their own", async () => {
  await withBroker([], async (broker, _root, events) => {
    assert.deepEqual(await broker.ask("secrets.get", { name: "API_TOKEN" }), {
      ok: true,
      value: "made-up-token-for-effects",
    });
    assert.deepEqual(await broker.ask("events.emit", { kind: "noted", detail: { a: 1 } }), {
      ok: true,
      value: null,
    });
    assert.ok(events.events.some((event) => event.kind === "noted"));
  });
});

test("a refusal by the effect rule is logged as a refused event, once", async () => {
  await withBroker(["read"], async (broker, _root, events) => {
    await broker.ask("files.write", { path: "notes-out/a.txt", text: "x" });
    const refusals = events.events.filter((event) => event.kind === "refused");
    assert.equal(refusals.length, 1);
    assert.match(JSON.stringify(refusals[0]?.detail), /needs the write effect/);
  });
});

type MethodRow = {
  readonly call: (broker: StepBroker) => Promise<Answer<unknown>>;
  readonly needs: readonly Effect[];
  readonly usesPorts: boolean;
};

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const brokerMethods: { readonly [Name in Parameters<StepBroker["ask"]>[0]]: MethodRow } = {
  "db.migrate": { call: (broker) => broker.ask("db.migrate", {}), needs: [], usesPorts: true },
  "db.execute": {
    call: (broker) => broker.ask("db.execute", { sql: "insert into notes values (1)", parameters: [] }),
    needs: ["write"],
    usesPorts: true,
  },
  "db.query": {
    call: (broker) => broker.ask("db.query", { sql: "select 1", parameters: [] }),
    needs: [],
    usesPorts: true,
  },
  "db.agentQuery": {
    call: (broker) => broker.ask("db.agentQuery", { sql: "select 1" }),
    needs: [],
    usesPorts: true,
  },
  "files.read": {
    call: (broker) => broker.ask("files.read", { path: "notes-in/today.md" }),
    needs: [],
    usesPorts: true,
  },
  "files.write": {
    call: (broker) => broker.ask("files.write", { path: "notes-out/a.txt", text: "x" }),
    needs: ["write"],
    usesPorts: true,
  },
  "files.list": { call: (broker) => broker.ask("files.list", { path: "notes-in" }), needs: [], usesPorts: true },
  "files.makeFolder": {
    call: (broker) => broker.ask("files.makeFolder", { path: "scratch/one" }),
    needs: ["write"],
    usesPorts: true,
  },
  "files.link": {
    call: (broker) => broker.ask("files.link", { path: "scratch/notes", target: "notes-in" }),
    needs: ["write"],
    usesPorts: true,
  },
  "files.remove": {
    call: (broker) => broker.ask("files.remove", { path: "scratch/one" }),
    needs: ["write", "delete"],
    usesPorts: true,
  },
  "secrets.get": { call: (broker) => broker.ask("secrets.get", { name: "API_TOKEN" }), needs: [], usesPorts: true },
  "http.request": {
    call: (broker) => broker.ask("http.request", { method: "GET", url: "https://api.example.com/x", headers: {} }),
    needs: ["network"],
    usesPorts: true,
  },
  "events.emit": {
    call: (broker) => broker.ask("events.emit", { kind: "noted", detail: {} }),
    needs: [],
    usesPorts: true,
  },
  spend: { call: (broker) => broker.ask("spend", { spending: { usd: 1 } }), needs: ["spend"], usesPorts: false },
  call: {
    call: (broker) => broker.ask("call", { reference: "items-store.put", input: {} }),
    needs: [],
    usesPorts: false,
  },
  "commands.run": {
    call: (broker) => broker.ask("commands.run", { name: "version", arguments: [], folder: ".", timeLimitSeconds: 30 }),
    needs: everyEffect,
    usesPorts: true,
  },
  "schemas.read": {
    call: (broker) => broker.ask("schemas.read", { schema: "schemas/none.json" }),
    needs: [],
    usesPorts: true,
  },
};

test("every broker method passes through the one rule: refused without its effect, allowed with it", async () => {
  for (const row of Object.values(brokerMethods)) {
    await withBroker([], async (broker) => {
      const answer = await row.call(broker);
      const first = row.needs[0];
      if (first === undefined) {
        assertNotRefusedForEffects(answer);
      } else {
        assertRefusedFor(answer, first);
      }
    });
    const allowing: readonly Effect[] = row.needs.length === 0 ? [] : ["write", ...row.needs];
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

type Asked = (broker: StepBroker) => Promise<Answer<unknown>>;

const operationsOfEntries: readonly (readonly [string, Asked, Effect | undefined])[] = [
  ["db.migrate", (broker) => broker.ask("db.migrate", {}), undefined],
  ["db.execute", (broker) => broker.ask("db.execute", { sql: "update notes set x = 1", parameters: [] }), "write"],
  ["db.execute", (broker) => broker.ask("db.execute", { sql: "select 1", parameters: [] }), undefined],
  ["db.query", (broker) => broker.ask("db.query", { sql: "select 'drop' as word", parameters: [] }), undefined],
  [
    "db.query",
    (broker) => broker.ask("db.query", { sql: "with a as (select 1) delete from notes", parameters: [] }),
    "write",
  ],
  ["db.agentQuery", (broker) => broker.ask("db.agentQuery", { sql: "select 1" }), undefined],
  ["files.read", (broker) => broker.ask("files.read", { path: "a" }), undefined],
  ["files.list", (broker) => broker.ask("files.list", { path: "a" }), undefined],
  ["files.write", (broker) => broker.ask("files.write", { path: "a", text: "" }), "write"],
  ["secrets.get", (broker) => broker.ask("secrets.get", { name: "A" }), undefined],
  [
    "http.request",
    (broker) => broker.ask("http.request", { method: "GET", url: "https://a.example", headers: {} }),
    "network",
  ],
  ["events.emit", (broker) => broker.ask("events.emit", { kind: "noted", detail: {} }), undefined],
  ["spend", (broker) => broker.ask("spend", { spending: { items: 0, usd: 0, tokens: 0 } }), undefined],
  ["spend", (broker) => broker.ask("spend", { spending: { items: 0, usd: 0, tokens: 3 } }), "spend"],
  [
    "commands.run",
    (broker) => broker.ask("commands.run", { name: "version", arguments: [], folder: ".", timeLimitSeconds: 30 }),
    "read",
  ],
];

function effectNamedBy<T>(answer: Answer<T>): string | undefined {
  if (answer.ok || answer.kind !== "refused") {
    return undefined;
  }
  const needed = /effects?; to allow it, add (\w+) to/.exec(answer.change)?.[1];
  const listedWith = answer.declared.includes(" is listed with: ");
  return needed ?? (listedWith ? /^To allow it, add (\w+) to/.exec(answer.change)?.[1] : undefined);
}

test("the rule names the first missing effect for each kind of operation", async () => {
  for (const [name, asked, needed] of operationsOfEntries) {
    await withBroker([], async (broker) => {
      assert.equal(effectNamedBy(await asked(broker)), needed, name);
    });
    await withBroker(["read", "write", "delete", "network", "spend"], async (broker) => {
      assert.equal(effectNamedBy(await asked(broker)), undefined, name);
    });
  }
});

test("a statement deletes when a word outside quotes and comments is delete, drop or truncate", async () => {
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
  await withBroker(["read", "write"], async (broker) => {
    for (const [sql, expected] of cases) {
      const answer = await broker.ask("db.execute", { sql, parameters: [] });
      assert.equal(effectNamedBy(answer) !== undefined, expected, sql);
    }
  });
});
