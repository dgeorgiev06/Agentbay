import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byteSize,
  fieldOf,
  hashOf,
  isRecord,
  numberField,
  parseJson,
  textField,
  textsField,
  toJson,
} from "../bay/json.ts";

test("toJson copies JSON values and refuses anything that is not JSON", () => {
  assert.deepEqual(toJson({ a: [1, "x", null, true, { b: 2 }] }), { a: [1, "x", null, true, { b: 2 }] });
  assert.throws(() => toJson(undefined), /not JSON/);
  assert.throws(() => toJson(Number.NaN), /not JSON/);
  assert.throws(() => toJson({ when: () => 1 }), /not JSON/);
  assert.deepEqual(parseJson('{"a":[1,2]}'), { a: [1, 2] });
});

test("canonical JSON sorts keys at every depth, so equal content hashes the same", () => {
  assert.equal(hashOf({ b: 1, a: [{ d: 1, c: 2 }] }), hashOf({ a: [{ c: 2, d: 1 }], b: 1 }));
  assert.equal(hashOf({ b: 1, a: 2 }), hashOf({ a: 2, b: 1 }));
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }));
  assert.match(hashOf(null), /^[0-9a-f]{64}$/);
});

test("sizes count UTF-8 bytes of the JSON text", () => {
  assert.equal(byteSize("é"), 4);
  assert.equal(byteSize({ a: 1 }), 7);
});

test("field readers return a field only when it has the asked type", () => {
  const value = { round: 2, skill: "draft", feedback: ["short", 3], nested: { x: 1 } };
  assert.deepEqual(fieldOf(value, "nested"), { x: 1 });
  assert.equal(fieldOf(value, "missing"), undefined);
  assert.equal(fieldOf([1], "0"), undefined);
  assert.equal(numberField(value, "round"), 2);
  assert.equal(numberField(value, "skill"), undefined);
  assert.equal(textField(value, "skill"), "draft");
  assert.equal(textField(value, "round"), undefined);
  assert.deepEqual(textsField(value, "feedback"), ["short"]);
  assert.deepEqual(textsField(value, "round"), []);
});

test("isRecord accepts plain objects only", () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord("text"), false);
});
