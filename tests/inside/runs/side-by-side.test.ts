import assert from "node:assert/strict";
import { test } from "node:test";
import { itemFrame, sharedFrame, turnsToTake } from "../../../bay/runs/budget.ts";
import {
  attemptsAfterRerun,
  cutReason,
  failureSentence,
  foreachEnd,
  itemsRerun,
  itemsToStart,
  type ItemEnd,
} from "../../../bay/runs/side-by-side.ts";
import { isDueAt } from "../../../bay/runs/run-ending.ts";
import { foreachItemKey, isInsideFrame, skillRoundOf } from "../../../bay/runs/step-key.ts";

const place = { stepId: "builds", key: "builds", stopped: false };

const skill = (stepKey: string) => ({ reason: "time" as const, stepKey, until: "2026-11-20T10:00:00.000Z" });

test("items start in item order up to the cap, and a freed lane takes the next queued item", () => {
  assert.deepEqual(itemsToStart(["queued", "queued", "queued", "queued"], 2), [0, 1]);
  assert.deepEqual(itemsToStart(["running", "running", "queued", "queued"], 2), []);
  assert.deepEqual(itemsToStart(["ended", "running", "queued", "queued"], 2), [2]);
  assert.deepEqual(itemsToStart(["ended", "ended", "ended"], 3), []);
  assert.deepEqual(itemsToStart(["queued", "queued"], 8), [0, 1]);
});

test("a foreach whose items all finished gives their outputs in item order", () => {
  const ends: ItemEnd[] = [
    { kind: "done", output: "a" },
    { kind: "done", output: "b" },
    { kind: "done", output: "c" },
  ];
  assert.deepEqual(foreachEnd(ends, place), { kind: "done", outputs: ["a", "b", "c"] });
});

test("a foreach waits on every waiting item, in item order, while none failed", () => {
  const ends: ItemEnd[] = [
    { kind: "waiting", waits: [skill("builds[0].a")] },
    { kind: "done", output: "b" },
    { kind: "waiting", waits: [skill("builds[2].a"), skill("builds[2].b")] },
  ];
  assert.deepEqual(foreachEnd(ends, place), {
    kind: "waiting",
    lead: skill("builds[0].a"),
    others: [skill("builds[2].a"), skill("builds[2].b")],
  });
});

test("failed items are all named with their position, key and reason, and the owner is asked last", () => {
  const ends: ItemEnd[] = [
    { kind: "failed", key: "builds[0]", reason: "The script a failed." },
    { kind: "waiting", waits: [skill("builds[1].a")] },
    { kind: "failed", key: "builds[2]~2", reason: "The script c failed." },
  ];
  const sentence =
    "Step builds failed for 2 of 3 items: item 0 (builds[0]): The script a failed.; " +
    "item 2 (builds[2]~2): The script c failed.";
  const question = `${sentence} Resume with --rerun to run the failed items again, or stop the run.`;
  assert.equal(failureSentence("builds", ends), sentence);
  assert.deepEqual(foreachEnd(ends, place), {
    kind: "asking",
    lead: skill("builds[1].a"),
    others: [{ reason: "owner", stepKey: "builds", question }],
    question,
  });
  assert.deepEqual(foreachEnd(ends, { ...place, stopped: true }), { kind: "failed", reason: sentence });
});

test("a failed item with nothing waiting asks the owner alone", () => {
  const ends: ItemEnd[] = [
    { kind: "done", output: 1 },
    { kind: "failed", key: "builds[1]", reason: "boom" },
  ];
  const end = foreachEnd(ends, place);
  assert.ok(end.kind === "asking");
  assert.equal(end.lead.reason, "owner");
  assert.deepEqual(end.others, []);
});

test("a reason past the safe length is cut, the cut counted in it", () => {
  const long = "x".repeat(500);
  assert.equal(cutReason(long).length, 200);
  assert.ok(cutReason(long).endsWith("…"));
  assert.equal(cutReason("short"), "short");
  assert.equal(cutReason("y".repeat(200)), "y".repeat(200));
});

test("a rerun raises the attempt of each failed item only", () => {
  const ends: ItemEnd[] = [
    { kind: "done", output: 1 },
    { kind: "failed", key: "k[1]", reason: "r" },
    { kind: "waiting", waits: [] },
    { kind: "failed", key: "k[3]~2", reason: "r" },
  ];
  const after = attemptsAfterRerun([1, 1, 1, 2], ends);
  assert.deepEqual(after, [1, 2, 1, 3]);
  assert.deepEqual(itemsRerun([1, 1, 1, 2], after), [1, 3]);
  assert.deepEqual(itemsRerun([1, 1], [1, 1]), []);
});

test("an item's key names its item, and a rerun's key also its attempt, and both read back", () => {
  assert.equal(foreachItemKey("builds", 0), "builds[0]");
  assert.equal(foreachItemKey("builds", 1, 2), "builds[1]~2");
  assert.notEqual(foreachItemKey("builds", 1), foreachItemKey("builds", 1, 2));
  assert.deepEqual(skillRoundOf("builds[1]~2.build/0#1"), { step: "builds[1]~2.build/0", round: 1 });
  assert.deepEqual(skillRoundOf("builds[1].build/0#1"), { step: "builds[1].build/0", round: 1 });
  assert.equal(isInsideFrame("builds[1]~2.build/0", "builds[1]~2.build"), true);
  assert.equal(isInsideFrame("builds[1]~2.build/0", "builds[1].build"), false);
});

test("a step that spends under a limit on dollars takes the turn of each side-by-side foreach above it", () => {
  const root = { limit: { usd: 1 }, spent: { items: 0, usd: 0, tokens: 0, minutes: 0 }, parent: undefined };
  const outer = sharedFrame(root);
  const item = itemFrame(outer);
  const inner = sharedFrame(item);
  const innerItem = itemFrame(inner);
  const turns = turnsToTake(innerItem, true);
  assert.deepEqual(
    turns.map((turn) => [turn.turns === outer.turns, turn.holder === item, turn.turns === inner.turns]),
    [
      [true, true, false],
      [false, false, true],
    ],
  );
  assert.deepEqual(turnsToTake(innerItem, false), []);
  const unlimited = itemFrame(sharedFrame({ ...root, limit: { minutes: 5 } }));
  assert.deepEqual(turnsToTake(unlimited, true), []);
});

test("a run whose second wait is a time that has come is due, and one whose times are all ahead is not", () => {
  const now = new Date("2026-11-20T10:00:00.000Z");
  const waiting = {
    status: "waiting" as const,
    reason: "skill" as const,
    stepKey: "each[0].write/0#1",
    also: [{ reason: "time" as const, stepKey: "each[1].pause", until: "2026-11-20T09:59:00.000Z" }],
  };
  assert.equal(isDueAt(waiting, now), true);
  const ahead = {
    ...waiting,
    also: [{ reason: "time" as const, stepKey: "each[1].pause", until: "2026-11-20T11:00:00.000Z" }],
  };
  assert.equal(isDueAt(ahead, now), false);
});
