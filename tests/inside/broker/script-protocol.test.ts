import assert from "node:assert/strict";
import { test } from "node:test";
import { childMessageOf, parentMessageOf } from "../../../bay/broker/script-protocol.ts";

test("a final message is read when its fields are there", () => {
  assert.deepEqual(childMessageOf('{"type":"done","output":[1]}'), { type: "done", output: [1] });
  assert.deepEqual(childMessageOf('{"type":"failed","reason":"no day"}'), { type: "failed", reason: "no day" });
  assert.deepEqual(childMessageOf('{"type":"crashed","reason":"TypeError: x"}'), {
    type: "crashed",
    reason: "TypeError: x",
  });
});

test("a request is read by the guard of the operation it names", () => {
  const line = JSON.stringify({
    type: "request",
    id: 1,
    operation: "http.request",
    request: { method: "GET", url: "https://api.example.com/x", headers: {} },
  });
  assert.deepEqual(childMessageOf(line), {
    type: "request",
    id: 1,
    asked: { operation: "http.request", request: { method: "GET", url: "https://api.example.com/x", headers: {} } },
  });
  assert.deepEqual(childMessageOf('{"type":"request","id":2,"operation":"files.read","request":{"path":"a"}}'), {
    type: "request",
    id: 2,
    asked: { operation: "files.read", request: { path: "a" } },
  });
});

test("a request its operation's guard refuses is read as unreadable, with the sentence its author reads", () => {
  const trace = JSON.stringify({
    type: "request",
    id: 1,
    operation: "http.request",
    request: { method: "TRACE", url: "x", headers: {} },
  });
  assert.deepEqual(childMessageOf(trace), {
    type: "unreadable-request",
    operation: "http.request",
    sentence: "The field method in the request for http.request is not one of GET, POST, PUT, PATCH, DELETE.",
  });
  assert.deepEqual(childMessageOf('{"type":"request","id":1,"operation":"files.read","request":{"path":3}}'), {
    type: "unreadable-request",
    operation: "files.read",
    sentence: "The field path in the request for files.read is not text.",
  });
  const extra = JSON.stringify({
    type: "request",
    id: 1,
    operation: "http.request",
    request: { method: "GET", url: "https://api.example.com/x", headers: {}, extra: true },
  });
  assert.deepEqual(childMessageOf(extra), {
    type: "unreadable-request",
    operation: "http.request",
    sentence:
      "The field extra in the request for http.request is not one it takes. " +
      "It takes the fields method, url, headers and body.",
  });
  assert.deepEqual(childMessageOf('{"type":"request","id":1,"operation":"spend"}'), {
    type: "unreadable-request",
    operation: "spend",
    sentence: "The request for spend is not a mapping.",
  });
});

test("an answer the child could not read is reported with the sentence its author reads", () => {
  const line = JSON.stringify({ type: "unread-answer", operation: "http.request", value: { status: null } });
  assert.deepEqual(childMessageOf(line), {
    type: "unread-answer",
    operation: "http.request",
    sentence: "The field status in the answer to http.request is not a number.",
  });
});

test("a report of an unread answer that its operation's guard reads is not a valid message", () => {
  assert.equal(childMessageOf('{"type":"unread-answer","operation":"files.read","value":"text"}'), undefined);
  assert.equal(childMessageOf('{"type":"unread-answer","operation":"shell","value":1}'), undefined);
  assert.equal(childMessageOf('{"type":"unread-answer","operation":"files.read"}'), undefined);
});

test("a line that is not a message of the protocol is not read", () => {
  for (const line of [
    "not json",
    "[1]",
    '{"type":"done"}',
    '{"type":"request","id":"1","operation":"files.read","request":{"path":"a"}}',
    '{"type":"request","id":1,"operation":"shell","request":{"command":"id"}}',
    '{"type":"request","id":1,"operation":"toString","request":{}}',
    '{"type":"request","id":1,"request":{"resource":"files.read","path":"a"}}',
    '{"type":"failed","reason":3}',
    '{"type":"answer","id":1,"answer":{"ok":true,"value":1}}',
  ]) {
    assert.equal(childMessageOf(line), undefined, line);
  }
});

test("the kernel's start and answer messages are read when their fields are there", () => {
  assert.deepEqual(parentMessageOf('{"type":"start","input":null,"settings":{},"now":"2026-11-15T00:00:00.000Z"}'), {
    type: "start",
    input: null,
    settings: {},
    now: "2026-11-15T00:00:00.000Z",
  });
  assert.equal(parentMessageOf('{"type":"start","input":null,"settings":{}}'), undefined);
  assert.deepEqual(parentMessageOf('{"type":"answer","id":1,"answer":{"ok":true,"value":[1]}}'), {
    type: "answer",
    id: 1,
    answer: { ok: true, value: [1] },
  });
  assert.equal(parentMessageOf('{"type":"answer","id":1,"answer":{"ok":false,"kind":"refused"}}'), undefined);
});
