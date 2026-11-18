import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { secondsToAsk } from "../scripts/lib/step.ts";
import { broken, held, unknown, verdictOf } from "../scripts/lib/verdicts.ts";

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

test("a toolchain call is asked what is left of proof's step, less the 60 seconds kept, and never more than 1000", () => {
  const asked = [0, 739, 740, 1000, 1739.5, 1740, 2000].map((spent) => secondsToAsk(spent, 1));
  assert.deepEqual(asked, [1000, 1000, 1000, 740, 0, 0, 0]);
});

test("a check call shares what is left among its checks, each asked at most 1000", () => {
  const asked = [0, 1000, 1740].map((spent) => secondsToAsk(spent, 5));
  assert.deepEqual(asked, [348, 148, 0]);
  assert.equal(secondsToAsk(0, 1), 1000);
});

test("the step's seconds proof counts with are the seconds its manifest declares for prove", async () => {
  const manifest = await readFile(join(import.meta.dirname, "..", "mode.yaml"), "utf8");
  const declared = Number(/scriptTimeLimitSeconds: (\d+)/.exec(manifest)?.[1]);
  assert.deepEqual([secondsToAsk(declared - 65, 1), secondsToAsk(declared - 60, 1)], [5, 0]);
});
