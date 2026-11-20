import assert from "node:assert/strict";
import { test } from "node:test";
import { noSpend } from "../../../bay/runs/budget.ts";
import { answerableSkill } from "../../../bay/runs/run-answers.ts";
import type { RunWithSteps, StepRecord, StoredState } from "../../../bay/runs/run-store.ts";
import { answer } from "../../runs-fixture.ts";

const at = "2026-11-14T09:00:00.000Z";

function skillAt(key: string, round: number, answered: boolean): StepRecord {
  const detail = {
    mode: "notes",
    action: "draft",
    skill: "skills/draft",
    tier: "balanced" as const,
    schemas: ["schemas/draft.json"],
    round,
    feedback: [],
    earlierSpent: noSpend,
    calledSpent: noSpend,
    ...(answered ? { submission: answer({ text: "an answer" }) } : {}),
  };
  return { key, kind: "skill", status: "started", input: {}, startedAt: at, detail };
}

function runWith(state: StoredState, steps: readonly StepRecord[]): RunWithSteps {
  const target = { kind: "workflow" as const, mode: "notes", name: "workflows/flow.yaml" };
  const base = { id: "run-1", target, input: {}, limit: {}, extra: {}, spent: noSpend, stopReason: undefined };
  return { ...base, state, steps, createdAt: at, updatedAt: at };
}

const waitingForBoth: StoredState = {
  status: "waiting",
  reason: "skill",
  stepKey: "each[0].write/0#2",
  also: [{ reason: "skill", stepKey: "each[1].write/0#1" }],
};

const twoItems = [skillAt("each[0].write/0", 2, false), skillAt("each[1].write/0", 1, false)];

const cases: readonly (readonly [string, RunWithSteps, string, ReadonlySet<string>, RegExp | undefined])[] = [
  [
    "the waited-for round of a waiting run",
    runWith(waitingForBoth, twoItems),
    "each[0].write/0#2",
    new Set(),
    undefined,
  ],
  ["the other item of a waiting run", runWith(waitingForBoth, twoItems), "each[1].write/0#1", new Set(), undefined],
  [
    "an earlier round of a waiting run",
    runWith(waitingForBoth, twoItems),
    "each[0].write/0#1",
    new Set(),
    /is not waiting for skill at step each\[0\]\.write\/0#1/,
  ],
  [
    "an earlier round of a run being advanced",
    runWith({ status: "running" }, twoItems),
    "each[0].write/0#1",
    new Set(),
    /already has a submission for each\[0\]\.write\/0#1/,
  ],
  [
    "a step the waiting run does not wait for",
    runWith({ status: "waiting", reason: "approval", stepKey: "keep" }, twoItems),
    "each[1].write/0#1",
    new Set(),
    /is not waiting for skill at step each\[1\]\.write\/0#1; it is waiting for approval at step keep/,
  ],
  [
    "a step of a run waiting for budget there",
    runWith({ status: "waiting", reason: "budget", stepKey: "each[1].write/0" }, twoItems),
    "each[1].write/0#1",
    new Set(),
    /is not waiting for skill at step each\[1\]\.write\/0#1; it is waiting for budget/,
  ],
  [
    "a step of a run being advanced",
    runWith({ status: "running" }, twoItems),
    "each[1].write/0#1",
    new Set(),
    undefined,
  ],
  [
    "a step whose answer is recorded",
    runWith({ status: "running" }, twoItems),
    "each[1].write/0#1",
    new Set(["each[1].write/0#1"]),
    /already has a submission/,
  ],
  [
    "a step whose answer is in its detail",
    runWith({ status: "running" }, [skillAt("each[1].write/0", 1, true)]),
    "each[1].write/0#1",
    new Set(),
    /already has a submission/,
  ],
  ["a run that has ended", runWith({ status: "done", output: [] }, twoItems), "each[1].write/0#1", new Set(), /ended/],
];

test("the answer rule takes only the waited-for round of an unanswered skill step of a live run", () => {
  for (const [name, run, stepKey, recorded, refusal] of cases) {
    const answered = answerableSkill(run, stepKey, recorded);
    if (refusal === undefined) {
      assert.ok(answered.ok, `${name}: ${JSON.stringify(answered)}`);
    } else {
      assert.ok(!answered.ok, name);
      assert.match(answered.problems.map((problem) => problem.message).join(" "), refusal, name);
    }
  }
  assert.ok(!answerableSkill(undefined, "each[1].write/0#1", new Set()).ok);
});
