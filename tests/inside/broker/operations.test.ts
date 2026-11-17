import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../bay/contracts.ts";
import { type OperationName, type Requests, type Results, shapes } from "../../../bay/broker/operations.ts";
import { refusedRequests, refusedResults } from "./operation-refusals.ts";

type Examples = {
  readonly [Name in OperationName]: {
    readonly requests: readonly [Required<Requests[Name]> & Json, Requests[Name] & Json];
    readonly results: readonly [Required<Results[Name]> & Json, Results[Name] & Json];
  };
};

const ran = {
  end: { how: "exited", exitCode: 0 },
  milliseconds: 12,
  stdout: { text: "On branch main\n", cut: false },
  stderr: { text: "", cut: false },
} as const;

const examples: Examples = {
  "db.execute": {
    requests: [
      { sql: "insert into items (title) values (?)", parameters: ["a"], partition: "feed-briefing" },
      { sql: "update items set title = :title", parameters: { title: "b" } },
    ],
    results: [
      { changes: 1, lastInsertRowid: 7 },
      { changes: 0, lastInsertRowid: 0 },
    ],
  },
  "db.query": {
    requests: [
      { sql: "select title from items where id = ?", parameters: [2], partition: "feed-briefing" },
      { sql: "select count(*) as n from items", parameters: [] },
    ],
    results: [[{ title: "a", id: 2 }], []],
  },
  "db.migrate": {
    requests: [{ partition: "feed-briefing" }, { partition: "store" }],
    results: [["0001-items.sql", "0002-tags.sql"], []],
  },
  "db.agentQuery": {
    requests: [
      { sql: "select id, title from items", partition: "feed-briefing" },
      { sql: "select 1", partition: "store" },
    ],
    results: [
      {
        columns: ["id", "title"],
        rows: [
          [1, "a"],
          [2, null],
        ],
      },
      { columns: [], rows: [] },
    ],
  },
  "files.read": {
    requests: [{ path: "notes-in/a.txt" }, { path: "" }],
    results: ["hello\n", ""],
  },
  "files.list": {
    requests: [{ path: "notes-in" }, { path: "." }],
    results: [["a.txt", "b.txt"], []],
  },
  "files.write": {
    requests: [
      { path: "notes-out/a.txt", text: "hello\n" },
      { path: "notes-out/empty.txt", text: "" },
    ],
    results: [null, null],
  },
  "files.makeFolder": {
    requests: [{ path: ".forge/copies/k3" }, { path: ".forge/copies/k4/inner" }],
    results: [null, null],
  },
  "files.link": {
    requests: [
      { path: ".forge/copies/k3/node_modules", target: "node_modules" },
      { path: ".forge/copies/k4/package.json", target: "package.json" },
    ],
    results: [null, null],
  },
  "files.remove": {
    requests: [{ path: ".forge/copies/k3" }, { path: ".forge/copies/k4/package.json" }],
    results: [null, null],
  },
  "secrets.get": {
    requests: [{ name: "API_TOKEN" }, { name: "" }],
    results: ["made-up-value", ""],
  },
  "http.request": {
    requests: [
      { method: "POST", url: "https://api.example.com/items", headers: { "content-type": "text/plain" }, body: "x" },
      { method: "GET", url: "https://api.example.com/items", headers: {} },
    ],
    results: [
      { status: 201, headers: { location: "/items/7" }, body: "" },
      { status: 200, headers: {}, body: "[]" },
    ],
  },
  "events.emit": {
    requests: [
      { kind: "briefed", detail: { items: 3, sources: ["a", "b"] } },
      { kind: "noted", detail: null },
    ],
    results: [null, null],
  },
  call: {
    requests: [
      { reference: "store.put", input: { key: "a", value: 1 } },
      { reference: "notes.look", input: [] },
    ],
    results: [{ stored: true }, null],
  },
  spend: {
    requests: [{ spending: { items: 1, usd: 0.25, tokens: 100 } }, { spending: {} }],
    results: [null, null],
  },
  "commands.run": {
    requests: [
      { command: ["git", "status"], folder: ".", timeLimitSeconds: 30, input: "y\n" },
      { command: ["git", "rev-parse", "HEAD"], folder: ".forge/copies/k3", timeLimitSeconds: 0.5 },
    ],
    results: [
      ran,
      {
        end: { how: "signalled", signal: "SIGTERM" },
        milliseconds: 3,
        stdout: { text: "", cut: false },
        stderr: { text: "…the end", cut: true },
      },
    ],
  },
};

const operationNames: readonly OperationName[] = [
  "db.execute",
  "db.query",
  "db.migrate",
  "db.agentQuery",
  "files.read",
  "files.list",
  "files.write",
  "files.makeFolder",
  "files.link",
  "files.remove",
  "secrets.get",
  "http.request",
  "events.emit",
  "call",
  "spend",
  "commands.run",
];

test("the table holds the sixteen operations a script can ask for, each with its resource", () => {
  assert.deepEqual(
    Object.entries(shapes).map(([name, shape]) => `${name} ${shape.resource}`),
    [
      "db.execute db",
      "db.query db",
      "db.migrate db",
      "db.agentQuery db",
      "files.read files",
      "files.list files",
      "files.write files",
      "files.makeFolder files",
      "files.link files",
      "files.remove files",
      "secrets.get secrets",
      "http.request http",
      "events.emit events",
      "call call",
      "spend spend",
      "commands.run commands",
    ],
  );
});

function roundTrip<Name extends OperationName>(name: Name, given: Examples[Name]): void {
  for (const request of given.requests) {
    assert.deepEqual(shapes[name].request(request), { ok: true, value: request }, `the request ${name}`);
  }
  for (const result of given.results) {
    assert.deepEqual(shapes[name].result(result), { ok: true, value: result }, `the result of ${name}`);
  }
}

for (const name of operationNames) {
  test(`${name}: two requests and two results pass their guards unchanged`, () => {
    roundTrip(name, examples[name]);
  });

  for (const refused of refusedRequests[name]) {
    test(`${name}: a request with ${refused.what} is refused with a sentence`, () => {
      assert.deepEqual(shapes[name].request(refused.value), { ok: false, problem: refused.problem });
    });
  }
}

function hasResultThatCanBeMalformed(name: OperationName): name is Exclude<OperationName, "call"> {
  return name !== "call";
}

for (const name of operationNames.filter(hasResultThatCanBeMalformed)) {
  for (const refused of refusedResults[name]) {
    test(`${name}: a result with ${refused.what} is refused with a sentence`, () => {
      assert.deepEqual(shapes[name].result(refused.value), { ok: false, problem: refused.problem });
    });
  }
}

test("call: every JSON value is a result, so no result of a call is malformed", () => {
  for (const value of [null, 0, "", [], {}, { nested: [true] }]) {
    assert.deepEqual(shapes.call.result(value), { ok: true, value });
  }
});

test("call: a number JSON cannot hold is not a result", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, [Number.NEGATIVE_INFINITY]]) {
    assert.deepEqual(shapes.call.result(value), { ok: false, problem: "The value is not a JSON value." });
  }
});

test("commands.run: an end that is none of exited, signalled and timed-out is refused", () => {
  assert.deepEqual(shapes["commands.run"].result({ ...ran, end: { how: "vanished" } }), {
    ok: false,
    problem: "The value is not a command's end, time and output.",
  });
  assert.deepEqual(shapes["commands.run"].result({ ...ran, end: { how: "timed-out" } }), {
    ok: true,
    value: { ...ran, end: { how: "timed-out" } },
  });
});

test("a request drops fields its operation does not have", () => {
  assert.deepEqual(shapes["files.read"].request({ path: "a.txt", text: "extra" }), {
    ok: true,
    value: { path: "a.txt" },
  });
});
