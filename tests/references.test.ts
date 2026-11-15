import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import {
  isReferenceText,
  parseReference,
  resolveInput,
  resolveReference,
  resolveValue,
  workflowReferenceIssues,
  type ReferenceScope,
} from "../bay/references.ts";

const scope: ReferenceScope = {
  trigger: { topic: "staking" },
  outputs: new Map<string, Json>([
    ["fetch", { items: [{ id: "a" }, { id: "b" }], total: null }],
    ["count", 2],
  ]),
  settings: { lookback: "3d" },
};

test("only a string that starts with $ is a reference", () => {
  assert.equal(isReferenceText("$trigger"), true);
  assert.equal(isReferenceText("price $5"), false);
  assert.equal(isReferenceText(5), false);
  assert.equal(isReferenceText({ value: "$trigger" }), false);
});

test("the four reference forms parse, and nothing else does", () => {
  assert.deepEqual(parseReference("$trigger"), { ok: true, reference: { kind: "trigger", text: "$trigger" } });
  assert.deepEqual(parseReference("$item"), { ok: true, reference: { kind: "item", text: "$item" } });
  assert.deepEqual(parseReference("$settings.lookback"), {
    ok: true,
    reference: { kind: "settings", text: "$settings.lookback", key: "lookback" },
  });
  assert.deepEqual(parseReference("$steps.fetch.output.items.0.id"), {
    ok: true,
    reference: { kind: "steps", text: "$steps.fetch.output.items.0.id", id: "fetch", path: ["items", "0", "id"] },
  });
  for (const text of ["$", "$trigger.topic", "$item.id", "$steps.fetch", "$steps.fetch.input", "$settings", "$x"]) {
    const parsed = parseReference(text);
    assert.ok(!parsed.ok, text);
    assert.match(parsed.message, new RegExp(`^\\${text} is not a reference`));
  }
});

test("references resolve whole against the trigger, step outputs, the item and settings", () => {
  const resolve = (text: string, within: ReferenceScope = scope) => resolveValue(text, within);
  assert.deepEqual(resolve("$trigger"), { ok: true, value: { topic: "staking" } });
  assert.deepEqual(resolve("$steps.fetch.output.items.1.id"), { ok: true, value: "b" });
  assert.deepEqual(resolve("$steps.fetch.output.total"), { ok: true, value: null });
  assert.deepEqual(resolve("$steps.count.output"), { ok: true, value: 2 });
  assert.deepEqual(resolve("$settings.lookback"), { ok: true, value: "3d" });
  assert.deepEqual(resolve("$item", { ...scope, item: "x" }), { ok: true, value: "x" });
  assert.deepEqual(resolve("plain text with $trigger inside"), { ok: true, value: "plain text with $trigger inside" });
});

test("a reference that resolves to nothing is a problem naming it and what was available", () => {
  const problemsOf = (text: string): readonly string[] => {
    const resolution = resolveValue(text, scope);
    assert.ok(!resolution.ok, text);
    return resolution.problems;
  };
  assert.deepEqual(problemsOf("$steps.later.output"), [
    "$steps.later.output resolves to nothing: no step later has finished before it (available: fetch, count).",
  ]);
  assert.deepEqual(problemsOf("$steps.fetch.output.items.7"), [
    "$steps.fetch.output.items.7 resolves to nothing: output.items of step fetch has no 7; it is a list of 2 elements.",
  ]);
  assert.match(problemsOf("$steps.fetch.output.size")[0] ?? "", /it is a mapping with the keys items, total/);
  assert.match(problemsOf("$steps.count.output.x")[0] ?? "", /it is the value 2/);
  assert.match(problemsOf("$settings.region")[0] ?? "", /have no region \(available: lookback\)/);
  assert.match(problemsOf("$item")[0] ?? "", /used outside a foreach/);
  assert.match(problemsOf("$nope")[0] ?? "", /is not a reference/);
});

test("resolveReference takes a parsed reference", () => {
  const parsed = parseReference("$steps.fetch.output.items.0");
  assert.ok(parsed.ok);
  assert.deepEqual(resolveReference(parsed.reference, scope), { ok: true, value: { id: "a" } });
});

test("an input mapping resolves each top-level value and reports every problem at once", () => {
  const nested = { keep: "$trigger" };
  assert.deepEqual(resolveInput({ topic: "$trigger", limit: 5, nested }, scope), {
    ok: true,
    value: { topic: { topic: "staking" }, limit: 5, nested: { keep: "$trigger" } },
  });
  const failed = resolveInput({ first: "$steps.nope.output", second: "$bad", fine: "$trigger" }, scope);
  assert.ok(!failed.ok);
  assert.equal(failed.problems.length, 2);
  assert.match(failed.problems[0] ?? "", /^input\.first: \$steps\.nope\.output resolves to nothing/);
  assert.match(failed.problems[1] ?? "", /^input\.second: \$bad is not a reference/);
});

test("workflow reference issues name the path of each bad reference", () => {
  const issues = workflowReferenceIssues([
    { id: "a", action: "x", input: { v: "$steps.b.output" } },
    { id: "b", foreach: "$steps.a.output", steps: [{ id: "c", approval: "ok?", show: "$item" }] },
    { id: "d", wait: "1h" },
    { id: "e", approval: "ok?", show: "$item" },
  ]);
  assert.deepEqual(
    issues.map((issue) => issue.path),
    [
      ["steps", 0, "input", "v"],
      ["steps", 3, "show"],
    ],
  );
});
