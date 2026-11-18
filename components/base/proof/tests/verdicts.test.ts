import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { secondsToAsk, stepSeconds } from "../scripts/lib/step.ts";
import { broken, held, notBuiltParts, unknown, verdictOf } from "../scripts/lib/verdicts.ts";

test("an item whose parts all passed is passed, with the sentence for a pass", () => {
  assert.deepEqual(verdictOf("DOD-1", "checks", { parts: [held, held], whenPassed: "Every part held." }), {
    item: "DOD-1",
    kind: "checks",
    verdict: "passed",
    detail: "Every part held.",
  });
});

test("an item with a failed part is failed, with each failed part's sentence", () => {
  const found = { parts: [held, broken("The first broke."), broken("The second broke.")] as const, whenPassed: "x" };
  assert.deepEqual(verdictOf("DOD-1", "fails-first", found), {
    item: "DOD-1",
    kind: "fails-first",
    verdict: "failed",
    detail: "The first broke. The second broke.",
  });
});

test("an inconclusive part beside a failed one makes the item inconclusive, and the failure is not shown (open question 8)", () => {
  const found = { parts: [broken("It broke."), unknown("It did not finish."), held] as const, whenPassed: "x" };
  assert.deepEqual(verdictOf("DOD-1", "checks", found), {
    item: "DOD-1",
    kind: "checks",
    verdict: "inconclusive",
    reason: "It did not finish.",
  });
});

test("a kind that is not built answers inconclusive with a sentence that says so, never passed", () => {
  assert.deepEqual(verdictOf("DOD-1", "bugs-caught", notBuiltParts("bugs-caught")), {
    item: "DOD-1",
    kind: "bugs-caught",
    verdict: "inconclusive",
    reason: "The kind bugs-caught is not built in this version of the proof mode, so nothing is known.",
  });
});

test("a toolchain call is asked what is left of proof's step, less the 60 seconds kept, and never more than 1000", () => {
  assert.deepEqual([0, 739, 740, 1000, 1739.5, 1740, 2000].map(secondsToAsk), [1000, 1000, 1000, 740, 0, 0, 0]);
});

test("the step's seconds proof counts with are the seconds its manifest declares for prove", async () => {
  const manifest = await readFile(join(import.meta.dirname, "..", "mode.yaml"), "utf8");
  assert.deepEqual(/scriptTimeLimitSeconds: (\d+)/.exec(manifest)?.[1], String(stepSeconds));
});
