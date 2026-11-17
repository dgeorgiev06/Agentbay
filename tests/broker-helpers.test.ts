import assert from "node:assert/strict";
import { test } from "node:test";
import { failed, granted, listed, manifestOf, refused } from "../bay/answers.ts";
import { isJson, isJsonRecord, parsedLine } from "../bay/protocol-json.ts";
import { scrubSecretPatterns } from "../bay/secret-patterns.ts";
import { grantsIn } from "./broker-fixture.ts";

test("a refusal says what was asked, what was declared and what to change, in one sentence", () => {
  const refusal = refused({ resource: "http", asked: "A asked", declared: "B declared", change: "Do C." });
  assert.equal(refusal.message, "A asked, but B declared. Do C.");
  assert.deepEqual(granted(3), { ok: true, value: 3 });
  assert.deepEqual(failed("no"), { ok: false, kind: "failed", message: "no" });
  assert.equal(listed([], "none"), "none");
  assert.equal(listed(["a", "b"], "none"), "a, b");
  assert.equal(manifestOf(grantsIn("/p")), "/p/components/modes/notes/mode.yaml");
});

test("JSON guards accept JSON values only", () => {
  assert.equal(isJson({ a: [1, "x", null, true] }), true);
  assert.equal(isJson({ a: Number.NaN }), false);
  assert.equal(isJson({ a: undefined }), false);
  assert.equal(
    isJson(() => 1),
    false,
  );
  assert.equal(isJsonRecord([1]), false);
  assert.equal(isJsonRecord({ a: 1 }), true);
  assert.equal(parsedLine("{oops"), undefined);
  assert.deepEqual(parsedLine('{"a":1}'), { a: 1 });
});

test("the pattern scrub replaces each kind of secret-shaped text", () => {
  assert.equal(scrubSecretPatterns("token=abc"), "token=abc");
  assert.equal(scrubSecretPatterns("pwd: hunter2!"), "[redacted:password]");
});
