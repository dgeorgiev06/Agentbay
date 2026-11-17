import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../bay/contracts.ts";
import {
  type OperationName,
  type Reading,
  type Requests,
  type Results,
  shapes,
  shownToAuthor,
} from "../../../bay/broker/operations.ts";
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
    requests: [{ sql: "select id, title from items", partition: "feed-briefing" }, { sql: "select 1" }],
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
      { name: "changes", arguments: [], folder: ".", timeLimitSeconds: 30, input: "y\n" },
      { name: "commit-of", arguments: ["HEAD"], folder: ".forge/copies/k3", timeLimitSeconds: 0.5 },
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

function sentenceOf(side: "request" | "result", operation: OperationName, reading: Reading<unknown>): string {
  return reading.ok ? "read" : shownToAuthor({ side, operation, misfit: reading.misfit });
}

function requestSentence(operation: OperationName, value: Json): string {
  return sentenceOf("request", operation, shapes[operation].request(value));
}

function answerSentence(operation: OperationName, value: Json): string {
  return sentenceOf("result", operation, shapes[operation].result(value));
}

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
      assert.equal(requestSentence(name, refused.value), refused.sentence);
    });
  }
}

function hasResultThatCanBeMalformed(name: OperationName): name is Exclude<OperationName, "call"> {
  return name !== "call";
}

for (const name of operationNames.filter(hasResultThatCanBeMalformed)) {
  for (const refused of refusedResults[name]) {
    test(`${name}: a result with ${refused.what} is refused with a sentence`, () => {
      assert.equal(answerSentence(name, refused.value), refused.sentence);
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
    assert.equal(answerSentence("call", value), "The answer to call is not a JSON value.");
  }
});

test("commands.run: an end that is none of exited, signalled and timed-out is refused", () => {
  assert.equal(
    answerSentence("commands.run", { ...ran, end: { how: "vanished" } }),
    "The field end.how in the answer to commands.run is not one of exited, signalled, timed-out.",
  );
  assert.deepEqual(shapes["commands.run"].result({ ...ran, end: { how: "timed-out" } }), {
    ok: true,
    value: { ...ran, end: { how: "timed-out" } },
  });
});

const marker = "made-up-marker-7f3a";

const sentencesByEntryFile: readonly (readonly [OperationName, Json, string])[] = [
  ["db.query", { parameters: [] }, "The field sql is missing from the request for db.query. It must be text."],
  [
    "db.query",
    { sql: "select 1", parameters: 3 },
    "The field parameters in the request for db.query is not a list or a mapping.",
  ],
  [
    "db.query",
    { sql: "select 1", parameters: [], params: [] },
    "The field params in the request for db.query is not one it takes. It takes the fields sql, parameters and partition.",
  ],
  [
    "files.write",
    { path: "notes-out/a.txt" },
    "The field text is missing from the request for files.write. It must be text.",
  ],
  ["files.write", { path: 7, text: "hello" }, "The field path in the request for files.write is not text."],
  [
    "files.write",
    { path: "notes-out/a.txt", text: "hello", content: "hello" },
    "The field content in the request for files.write is not one it takes. It takes the fields path and text.",
  ],
  [
    "http.request",
    { method: "GET", headers: {} },
    "The field url is missing from the request for http.request. It must be text.",
  ],
  [
    "http.request",
    { method: "TRACE", url: "https://api.example.com", headers: {} },
    "The field method in the request for http.request is not one of GET, POST, PUT, PATCH, DELETE.",
  ],
  [
    "http.request",
    { method: "GET", url: "https://api.example.com", headers: {}, timeout: 5 },
    "The field timeout in the request for http.request is not one it takes. It takes the fields method, url, headers and body.",
  ],
  [
    "http.request",
    { method: "GET", url: "https://api.example.com", headers: { accept: 1 } },
    "The field headers.accept in the request for http.request is not text.",
  ],
  [
    "commands.run",
    { name: "changes", arguments: [], timeLimitSeconds: 30 },
    "The field folder is missing from the request for commands.run. It must be text.",
  ],
  [
    "commands.run",
    { name: "changes", arguments: [], folder: ".", timeLimitSeconds: "30" },
    "The field timeLimitSeconds in the request for commands.run is not a number.",
  ],
  [
    "commands.run",
    { name: "changes", arguments: [], folder: ".", timeLimitSeconds: 30, command: "git" },
    "The field command in the request for commands.run is not one it takes. " +
      "It takes the fields name, arguments, folder, timeLimitSeconds and input.",
  ],
  [
    "commands.run",
    { name: "changes", arguments: ["--short", 1], folder: ".", timeLimitSeconds: 30 },
    "The field arguments[1] in the request for commands.run is not text.",
  ],
  [
    "events.emit",
    { kind: "noted" },
    "The field detail is missing from the request for events.emit. It must be a JSON value.",
  ],
  ["events.emit", { kind: false, detail: null }, "The field kind in the request for events.emit is not text."],
  [
    "events.emit",
    { kind: "noted", detail: null, level: "info" },
    "The field level in the request for events.emit is not one it takes. It takes the fields kind and detail.",
  ],
  ["secrets.get", {}, "The field name is missing from the request for secrets.get. It must be text."],
  ["files.read", "notes-in/a.txt", "The request for files.read is not a mapping."],
];

test("a malformed request of each entry file's operations is shown to its author as the field's path and what it must be", () => {
  for (const [operation, value, sentence] of sentencesByEntryFile) {
    assert.equal(requestSentence(operation, value), sentence, JSON.stringify(value));
  }
});

test("the sentence for a malformed request never holds the value that was wrong", () => {
  const wrongValues: readonly (readonly [OperationName, Json])[] = [
    ["db.query", { sql: "select 1", parameters: marker }],
    ["files.write", { path: [marker], text: "hello" }],
    ["http.request", { method: marker, url: "https://api.example.com", headers: {} }],
    ["http.request", { method: "GET", url: "https://api.example.com", headers: { accept: [marker] } }],
    ["commands.run", { name: "changes", arguments: [marker, 1], folder: ".", timeLimitSeconds: marker }],
    ["events.emit", { kind: { marker }, detail: null }],
    ["call", { reference: [marker], input: marker }],
  ];
  for (const [operation, value] of wrongValues) {
    const sentence = requestSentence(operation, value);
    assert.notEqual(sentence, "read");
    assert.ok(!sentence.includes(marker), sentence);
  }
});

test("an answer the toolbox could not read is shown as the field's path in the answer and what it must be", () => {
  assert.equal(
    answerSentence("commands.run", { ...ran, stdout: { text: "", cut: "no" } }),
    "The field stdout.cut in the answer to commands.run is not true or false.",
  );
  assert.equal(
    answerSentence("http.request", { status: null, headers: {}, body: "" }),
    "The field status in the answer to http.request is not a number.",
  );
  assert.equal(answerSentence("files.read", null), "The answer to files.read is not text.");
});
