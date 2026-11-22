import assert from "node:assert/strict";
import { test } from "node:test";
import { workedOutLines } from "../scripts/lib/lines.ts";
import type { Feature, Plan, PlannedSlice } from "../scripts/lib/plan.ts";
import { workOut } from "../scripts/lib/plan-waves.ts";

function slice(name: string, scope: readonly string[], after: readonly string[] = []): PlannedSlice {
  return {
    name,
    title: `The slice ${name}`,
    kind: "mode",
    scope,
    after: after.map((other) => ({ slice: other, because: `${name} reads what ${other} adds.` })),
    tests: [],
  };
}

function linesOf(plan: Plan, features: readonly Feature[] = []): readonly string[] {
  return workedOutLines(plan, workOut(plan, features));
}

test("an empty plan is its title and one line saying it has no waves", () => {
  assert.deepEqual(linesOf({ title: "Empty", slices: [] }), ["Empty", "The plan has no slices, so it has no waves."]);
});

test("a cycle's slices are named as in no wave, counts of one are singular, and each problem is its level and sentence", () => {
  const slices = [slice("A", ["a/**"], ["B"]), slice("B", ["b/**"], ["A"]), slice("C", ["c/**"])];
  assert.deepEqual(linesOf({ title: "Cycle", slices }), [
    "Cycle",
    "3 slices in 1 wave. Longest chain, 1 slice: C.",
    "Not in any wave, since each is in a cycle or after one: A, B.",
    "",
    "Slices",
    "A (mode) The slice A",
    "  scope: a/**",
    "  after B: A reads what B adds.",
    "B (mode) The slice B",
    "  scope: b/**",
    "  after A: B reads what A adds.",
    "C (mode) The slice C",
    "  scope: c/**",
    "  after nothing",
    "",
    "Waves",
    "wave 1: C (1 builder)",
    "",
    "Problems",
    "error: A and B wait for each other, so none of them can start. Remove an after among them.",
  ]);
});

test("a warning is said with its level, after the errors in the order they were found", () => {
  const features: readonly Feature[] = [{ name: "runs", private: ["bay/runs/engine.ts"] }];
  const slices = [slice("A", ["bay/runs/**"], ["Z"])];
  assert.deepEqual(linesOf({ title: "Feature", slices }, features).slice(-3), [
    "Problems",
    "error: A comes after Z, but the plan has no slice named Z. Correct the name, or add the slice.",
    "warning: A's scope admits every private file of the kernel feature runs. The feature may need an entry first, so that a slice can be given a narrower scope.",
  ]);
});
