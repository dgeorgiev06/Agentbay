import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answer } from "../../../bay/answers.ts";
import type { Json } from "../../../bay/contracts.ts";
import { contextOver, type OperationName, type ScriptStart } from "../../../bay/broker/operations.ts";
import type { ScriptContext } from "../../../bay/sdk.ts";

type Asked = readonly [OperationName, Json];

type Recording = {
  readonly context: ScriptContext;
  readonly asked: Asked[];
  readonly unread: Asked[];
};

const ran = {
  end: { how: "exited", exitCode: 0 },
  milliseconds: 4,
  stdout: { text: "", cut: false },
  stderr: { text: "", cut: false },
};

const fitting: { readonly [Name in OperationName]: Json } = {
  "db.execute": { changes: 1, lastInsertRowid: 2 },
  "db.query": [{ id: 1 }],
  "db.migrate": ["0001-notes.sql"],
  "db.agentQuery": { columns: ["n"], rows: [[1]] },
  "files.read": "text",
  "files.list": ["a.md"],
  "files.write": null,
  "files.makeFolder": null,
  "files.link": null,
  "files.remove": null,
  "secrets.get": "made-up-value",
  "http.request": { status: 200, headers: {}, body: "remote" },
  "events.emit": null,
  call: { called: true },
  spend: null,
  "commands.run": ran,
};

const start: ScriptStart = {
  settings: { lookback: "3d" },
  now: "2026-11-17T08:00:00.000Z",
  caller: "briefing",
  skillInput: { items: ["a:1"] },
};

function recording(answer: (operation: OperationName) => Answer<Json>): Recording {
  const asked: Asked[] = [];
  const unread: Asked[] = [];
  const context = contextOver(
    {
      ask: (operation, request) => {
        asked.push([operation, request]);
        return Promise.resolve(answer(operation));
      },
      reportUnreadAnswer: (operation, value) => {
        unread.push([operation, value]);
      },
    },
    start,
  );
  return { context, asked, unread };
}

function fittingAnswers(): Recording {
  return recording((operation) => ({ ok: true, value: fitting[operation] }));
}

const command = { name: "changes", arguments: ["--short"], folder: ".", timeLimitSeconds: 30 };

const httpRequest = { method: "GET" as const, url: "https://api.example.com/x", headers: {} };

async function everyMember(context: ScriptContext): Promise<readonly Answer<Json>[]> {
  const partition = context.db.partition("feed-briefing");
  return [
    await context.db.execute("insert into notes values (?)", ["a"]),
    await context.db.execute("delete from notes"),
    await context.db.query("select id from notes where id = ?", [1]),
    await context.db.query("select id from notes"),
    await partition.migrate(),
    await partition.execute("insert into items values (:id)", { id: 2 }),
    await partition.execute("delete from items"),
    await partition.query("select id from items", [3]),
    await partition.query("select id from items"),
    await partition.agentQuery("select count(*) as n from items"),
    await context.files.read("notes-in/a.md"),
    await context.files.write("notes-out/a.md", "hello"),
    await context.files.list("notes-in"),
    await context.files.makeFolder(".forge/copies/k3"),
    await context.files.link(".forge/copies/k3/node_modules", "node_modules"),
    await context.files.remove(".forge/copies/k3"),
    await context.secrets.get("API_TOKEN"),
    await context.http.request(httpRequest),
    await context.events.emit("noted", { day: "2026-11-17" }),
    await context.commands.run(command),
    await context.call("items-store.put", { day: "2026-11-17" }),
    await context.spend({ items: 2, usd: 0.25 }),
  ];
}

test("each member of the context asks for its own operation with the request built from its arguments", async () => {
  const { context, asked } = fittingAnswers();
  await everyMember(context);
  assert.deepEqual(asked, [
    ["db.execute", { sql: "insert into notes values (?)", parameters: ["a"] }],
    ["db.execute", { sql: "delete from notes", parameters: [] }],
    ["db.query", { sql: "select id from notes where id = ?", parameters: [1] }],
    ["db.query", { sql: "select id from notes", parameters: [] }],
    ["db.migrate", { partition: "feed-briefing" }],
    ["db.execute", { sql: "insert into items values (:id)", parameters: { id: 2 }, partition: "feed-briefing" }],
    ["db.execute", { sql: "delete from items", parameters: [], partition: "feed-briefing" }],
    ["db.query", { sql: "select id from items", parameters: [3], partition: "feed-briefing" }],
    ["db.query", { sql: "select id from items", parameters: [], partition: "feed-briefing" }],
    ["db.agentQuery", { sql: "select count(*) as n from items", partition: "feed-briefing" }],
    ["files.read", { path: "notes-in/a.md" }],
    ["files.write", { path: "notes-out/a.md", text: "hello" }],
    ["files.list", { path: "notes-in" }],
    ["files.makeFolder", { path: ".forge/copies/k3" }],
    ["files.link", { path: ".forge/copies/k3/node_modules", target: "node_modules" }],
    ["files.remove", { path: ".forge/copies/k3" }],
    ["secrets.get", { name: "API_TOKEN" }],
    ["http.request", { method: "GET", url: "https://api.example.com/x", headers: {} }],
    ["events.emit", { kind: "noted", detail: { day: "2026-11-17" } }],
    ["commands.run", { name: "changes", arguments: ["--short"], folder: ".", timeLimitSeconds: 30 }],
    ["call", { reference: "items-store.put", input: { day: "2026-11-17" } }],
    ["spend", { spending: { items: 2, usd: 0.25 } }],
  ]);
});

test("an answer that fits its operation's result reaches the script as it came", async () => {
  const { context, unread } = fittingAnswers();
  const answers = await everyMember(context);
  assert.deepEqual(answers, [
    { ok: true, value: { changes: 1, lastInsertRowid: 2 } },
    { ok: true, value: { changes: 1, lastInsertRowid: 2 } },
    { ok: true, value: [{ id: 1 }] },
    { ok: true, value: [{ id: 1 }] },
    { ok: true, value: ["0001-notes.sql"] },
    { ok: true, value: { changes: 1, lastInsertRowid: 2 } },
    { ok: true, value: { changes: 1, lastInsertRowid: 2 } },
    { ok: true, value: [{ id: 1 }] },
    { ok: true, value: [{ id: 1 }] },
    { ok: true, value: { columns: ["n"], rows: [[1]] } },
    { ok: true, value: "text" },
    { ok: true, value: null },
    { ok: true, value: ["a.md"] },
    { ok: true, value: null },
    { ok: true, value: null },
    { ok: true, value: null },
    { ok: true, value: "made-up-value" },
    { ok: true, value: { status: 200, headers: {}, body: "remote" } },
    { ok: true, value: null },
    { ok: true, value: ran },
    { ok: true, value: { called: true } },
    { ok: true, value: null },
  ]);
  assert.deepEqual(unread, []);
});

test("an answer that does not fit gives the script today's sentence and is reported with its operation", async () => {
  const { context, unread } = recording((operation) => ({
    ok: true,
    value: operation === "files.read" ? ["not", "text"] : "not a fitting value",
  }));
  assert.deepEqual(await context.files.read("notes-in/a.md"), {
    ok: false,
    kind: "failed",
    message: "The broker's answer did not have the expected shape.",
  });
  assert.deepEqual(await context.files.remove(".forge/copies/k3"), {
    ok: false,
    kind: "failed",
    message: "The broker's answer did not have the expected shape.",
  });
  assert.deepEqual(await context.http.request(httpRequest), {
    ok: false,
    kind: "failed",
    message: "The broker's answer did not have the expected shape.",
  });
  assert.deepEqual(unread, [
    ["files.read", ["not", "text"]],
    ["files.remove", "not a fitting value"],
    ["http.request", "not a fitting value"],
  ]);
});

test("a refusal or a failure reaches the script unchanged and is not reported", async () => {
  const refusal: Answer<Json> = {
    ok: false,
    kind: "refused",
    resource: "files",
    asked: "The step look.0 asked to read secret.txt",
    declared: "the mode notes may read only: notes-in",
    change: "To allow it, add secret.txt under resources.files.read.",
    message: "The step look.0 asked to read secret.txt, but the mode notes may read only: notes-in. To allow it.",
  };
  const refusing = recording(() => refusal);
  assert.deepEqual(await refusing.context.files.read("secret.txt"), refusal);
  const failing = recording(() => ({ ok: false, kind: "failed", message: "The file a.md does not exist." }));
  assert.deepEqual(await failing.context.files.read("a.md"), {
    ok: false,
    kind: "failed",
    message: "The file a.md does not exist.",
  });
  assert.deepEqual([...refusing.unread, ...failing.unread], []);
});

test("the context carries the start's settings, time, caller and skill input", () => {
  const { context } = fittingAnswers();
  assert.deepEqual(context.settings, { lookback: "3d" });
  assert.equal(context.now().toISOString(), "2026-11-17T08:00:00.000Z");
  assert.equal(context.caller, "briefing");
  assert.deepEqual(context.skillInput, { items: ["a:1"] });
});

test("a start with no caller and no skill input gives a context with neither", () => {
  const context = contextOver(
    { ask: () => Promise.resolve({ ok: true, value: null }), reportUnreadAnswer: () => undefined },
    { settings: {}, now: "2026-11-17T08:00:00.000Z" },
  );
  assert.equal(context.caller, undefined);
  assert.equal(context.skillInput, undefined);
});
