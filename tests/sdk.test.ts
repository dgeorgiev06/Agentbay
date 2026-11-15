import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson, defineScript, fail, isWithinWindow, parseIsoTime, shortHash } from "../bay/sdk.ts";

test("canonical JSON sorts keys by UTF-16 code units at every level and has no whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, "x"], é: 2, Z: 0 }), '{"Z":0,"a":[true,null,"x"],"b":1,"é":2}');
  assert.equal(canonicalJson({ outer: { z: 1, y: { b: 2, a: 1 } } }), '{"outer":{"y":{"a":1,"b":2},"z":1}}');
  assert.equal(canonicalJson([]), "[]");
  assert.equal(canonicalJson({}), "{}");
  assert.equal(canonicalJson('line\nbreak "quoted"'), '"line\\nbreak \\"quoted\\""');
});

test("canonical JSON writes numbers as JavaScript does, with negative zero as 0", () => {
  assert.equal(canonicalJson([0.1, 1e21, 1e-7, -0, 100, -5.5]), "[0.1,1e+21,1e-7,0,100,-5.5]");
});

test("canonical JSON refuses numbers JSON cannot hold", () => {
  assert.throws(() => canonicalJson([Number.NaN]), /not a finite number/);
  assert.throws(() => canonicalJson({ x: Number.POSITIVE_INFINITY }), /not a finite number/);
});

test("the same value gives the same canonical text whatever the key order", () => {
  assert.equal(canonicalJson({ a: 1, b: { c: 2, d: 3 } }), canonicalJson({ b: { d: 3, c: 2 }, a: 1 }));
});

test("the short hash is the first 16 hex digits of the SHA-256 of the canonical JSON", () => {
  assert.equal(shortHash({ a: 1 }), "015abd7f5cc57a2d");
  assert.equal(shortHash({ b: 1, a: [true, null, "x"], é: 2, Z: 0 }), "7c9c90466e8caeba");
  assert.equal(shortHash({ Z: 0, é: 2, a: [true, null, "x"], b: 1 }), "7c9c90466e8caeba");
});

test("ISO times with a zone are parsed, and anything else is not", () => {
  assert.equal(parseIsoTime("2026-11-14T08:00:00Z")?.toISOString(), "2026-11-14T08:00:00.000Z");
  assert.equal(parseIsoTime("2026-11-14T10:00:00.250+02:00")?.toISOString(), "2026-11-14T08:00:00.250Z");
  assert.equal(parseIsoTime("2026-11-14T08:00Z")?.toISOString(), "2026-11-14T08:00:00.000Z");
  for (const text of [
    "2026-11-14",
    "2026-11-14T08:00:00",
    "2026-02-30T00:00:00Z",
    "yesterday",
    "2026-11-14T25:00:00Z",
  ]) {
    assert.equal(parseIsoTime(text), undefined, text);
  }
});

test("a time window includes its start and excludes its end", () => {
  const window = { start: new Date("2026-11-14T00:00:00Z"), end: new Date("2026-11-15T00:00:00Z") };
  assert.equal(isWithinWindow(new Date("2026-11-14T00:00:00Z"), window), true);
  assert.equal(isWithinWindow(new Date("2026-11-14T23:59:59Z"), window), true);
  assert.equal(isWithinWindow(new Date("2026-11-15T00:00:00Z"), window), false);
  assert.equal(isWithinWindow(new Date("2026-11-13T23:59:59Z"), window), false);
});

test("defineScript marks a handler so the host can recognise it", () => {
  const handler = (input: unknown): Promise<{ readonly echoed: string }> => Promise.resolve({ echoed: String(input) });
  const script = defineScript(handler);
  assert.equal(script.kind, "agentbay-script");
  assert.equal(script.handler, handler);
});

test("fail throws an Error that carries a tagged script error with the reason", () => {
  assert.throws(
    () => fail("the input names no day"),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "the input names no day" &&
      JSON.stringify(error.cause) === '{"kind":"script-error","reason":"the input names no day"}',
  );
});
