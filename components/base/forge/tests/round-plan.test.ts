import assert from "node:assert/strict";
import { test } from "node:test";
import type { CardLine } from "../scripts/lib/card-lines.ts";
import { drawn } from "../scripts/lib/merge-card.ts";
import { sliceOf } from "../scripts/lib/slice-form.ts";
import type { Failing } from "../scripts/lib/failing.ts";
import type { Finding } from "../scripts/lib/review.ts";
import { roundsOnCard } from "../scripts/lib/round-card.ts";
import { findingsLeft, reviewedState, reviewPlan, roundPlan, type RoundsState } from "../scripts/lib/rounds.ts";

const commit = "a".repeat(40);

const noFailing: Failing = { items: [], cases: [], withheld: 0, notListed: 0, notLoaded: [] };

const proved: RoundsState = {
  round: 1,
  stage: "proved",
  done: false,
  base: commit,
  built: { outcome: "built" },
  builder: { branch: "forge/P1", commit },
  head: commit,
  branch: "forge/P1-tests-1",
  folder: ".forge/worktrees/P1-tests-1",
  declared: { files: [], names: { gained: [], lost: [], changed: [] } },
  tests: ["components/modes/p1/tests/quill.test.ts"],
  verdicts: [],
  failing: noFailing,
  toBuilder: [],
  toTests: 0,
  conditions: [],
  remaining: [],
  leaks: [],
};

const failingOne = { ...noFailing, items: ["DOD-P1-1"], cases: [{ name: "a quill is counted" }] };

const forBuilder: Finding = { to: "builder", case: "a quill is counted", question: "P-05", fix: "Count once." };

const forTests: Finding = { to: "test-writer", case: "a quill is counted", question: "Q2", fix: "Assert all." };

const held = { item: "DOD-P1-1", held: true as const, cases: ["a quill is counted"] };

const notHeld = { item: "DOD-P1-2", held: false as const, why: "No case refuses an empty quill." };

const slice = sliceOf({
  name: "P1",
  kind: "mode",
  scope: ["components/modes/p1/**"],
  after: [],
  done: [
    { id: "DOD-P1-1", says: "A quill is counted.", level: "must", proof: { kind: "fails-first", tests: [] } },
    { id: "DOD-P1-2", says: "An empty quill is refused.", level: "must" },
  ],
});

const passedProof = {
  verdicts: [{ item: "DOD-P1-1", kind: "fails-first" as const, verdict: "passed" as const, detail: "It held." }],
  size: [],
};

function reviewed(state: RoundsState, findings: readonly Finding[]): RoundsState {
  const review = { conditions: [held, notHeld], findings };
  return reviewedState(state, { plan: "review", review, remaining: findingsLeft(findings, []) }, "review-1");
}

test("round 1 asks the test writer and the builder; a done review asks no one", () => {
  assert.deepEqual(roundPlan(undefined), { writeTests: true, build: true });
  assert.equal(roundPlan({ ...proved, stage: "reviewed", done: true }), undefined);
});

test("a later round asks the test writer only for its findings, and the builder for its findings or failing cases", () => {
  const before = { ...proved, stage: "reviewed" as const };
  assert.deepEqual(roundPlan({ ...before, toTests: 1 }), { writeTests: true, build: false });
  assert.deepEqual(roundPlan({ ...before, toBuilder: [forBuilder] }), { writeTests: false, build: true });
  assert.deepEqual(roundPlan({ ...before, failing: failingOne }), { writeTests: false, build: true });
  assert.deepEqual(roundPlan({ ...before, toTests: 2, failing: failingOne }), { writeTests: true, build: true });
});

test("a review passes on a reviewed state, stops on a stopped builder, and sends failing cases back before round 3", () => {
  assert.equal(reviewPlan({ ...proved, stage: "reviewed" }), "pass-on");
  assert.equal(
    reviewPlan({ ...proved, built: { outcome: "stopped", missing: { lacks: "kernel", name: "x" } } }),
    "stopped",
  );
  assert.equal(reviewPlan({ ...proved, failing: failingOne }), "failing");
  assert.equal(reviewPlan({ ...proved, round: 2, failing: failingOne }), "failing");
  assert.equal(reviewPlan({ ...proved, round: 3, failing: failingOne }), "review");
  assert.equal(reviewPlan(proved), "review");
});

test("after review, findings split by addressee, and the tests worktree is no longer named", () => {
  const next = reviewed(proved, [forBuilder, forTests]);
  assert.equal(next.done, false);
  assert.equal(next.stage, "reviewed");
  assert.equal(next.folder, undefined);
  assert.deepEqual(next.toBuilder, [forBuilder]);
  assert.equal(next.toTests, 1);
  assert.equal(next.reviewedAt, "review-1");
  assert.deepEqual(next.remaining, []);
});

test("a review with no finding ends the rounds; round 3's review ends them with what remains", () => {
  assert.equal(reviewed(proved, []).done, true);
  const third = reviewed({ ...proved, round: 3 }, [forTests]);
  assert.equal(third.done, true);
  assert.deepEqual(third.toBuilder, []);
  assert.equal(third.toTests, 0);
  assert.deepEqual(third.remaining, [
    { to: "test-writer", case: "a quill is counted", question: "Q2", fix: "Assert all." },
  ]);
});

test("failing cases go back without a model, and a stopped builder ends the rounds", () => {
  const failing = reviewedState({ ...proved, failing: failingOne }, { plan: "failing" }, "review-1");
  assert.equal(failing.done, false);
  assert.equal(failing.reviewedAt, undefined);
  assert.deepEqual(failing.failing, failingOne);
  assert.equal(reviewedState(proved, { plan: "stopped" }, "review-1").done, true);
});

test("the card counts the rounds and gives the reviewer's verdicts and what remains as judged lines of its step", () => {
  const state = reviewed({ ...proved, round: 3 }, [forBuilder, forTests]);
  assert.deepEqual(roundsOnCard({ ...state, reviewedAt: "review-3" }), {
    count: 3,
    most: 3,
    ended: "last-round",
    judged: {
      step: "review-3",
      round: 3,
      sentences: [
        "DOD-P1-1 held by 1 case",
        "DOD-P1-2 not held: No case refuses an empty quill.",
        "2 findings remain: 1 for the builder, 1 for the test writer",
        "for the builder, P-05: Count once.",
        "for the test writer, Q2, a quill is counted: Assert all.",
      ],
    },
  });
});

test("a finding that remains keeps its fix only when the fix shares no run of 20 characters with the tests", () => {
  const tests = ['test("a quill is counted", () => count("ABCDEFGHIJKLMNOPQRSTUVWXYZ") === 1);'];
  const quoting: Finding = { ...forTests, fix: "Assert the count of ABCDEFGHIJKLMNOPQRSTUVWXYZ." };
  assert.deepEqual(findingsLeft([forBuilder, forTests, quoting], tests), [
    { to: "builder", case: "a quill is counted", question: "P-05", fix: "Count once." },
    { to: "test-writer", case: "a quill is counted", question: "Q2", fix: "Assert all." },
    { to: "test-writer", case: "a quill is counted", question: "Q2" },
  ]);
});

test("each finding that remains says what was asked, and one whose fix quotes a test says it is kept from the card", () => {
  const quoting = {
    ...reviewed({ ...proved, round: 3 }, []),
    remaining: [{ to: "test-writer" as const, case: "a quill\u0007 is counted", question: "Q2" }],
  };
  assert.equal(
    roundsOnCard(quoting).judged?.sentences.at(-1),
    "for the test writer, Q2, a quill is counted: kept from the card: it quotes a test",
  );
});

test("the reviewer's lines follow one computed line that names the round they were judged in, before the final proof", () => {
  const state = { ...reviewed({ ...proved, round: 3 }, []), reviewedAt: "review-2" };
  const lines = cardOf(roundsOnCard(state)).card.lines;
  const first = lines.findIndex((line) => line.mark === "judged");
  assert.deepEqual(lines[first - 1], {
    mark: "computed",
    words: "the reviewer, in round 2, before the final proof:",
    source: { step: "draw" },
  });
});

test("one finding remaining is said in the singular, and none as none; at most three are named", () => {
  const one = roundsOnCard(reviewed({ ...proved, round: 3 }, [forTests])).judged?.sentences ?? [];
  assert.ok(one.includes("1 finding remains: 0 for the builder, 1 for the test writer"));
  const none = roundsOnCard(reviewed(proved, [])).judged?.sentences ?? [];
  assert.equal(none.at(-1), "no finding remains");
  const four = roundsOnCard(reviewed({ ...proved, round: 3 }, [forTests, forTests, forTests, forBuilder]));
  assert.equal(four.judged?.sentences.length, 2 + 1 + 3);
});

test("with no review, the card has the rounds count and no judged line", () => {
  assert.deepEqual(roundsOnCard({ ...proved, stage: "reviewed", round: 2 }), {
    count: 2,
    most: 3,
    ended: "last-round",
  });
});

function cardOf(rounds: ReturnType<typeof roundsOnCard>): ReturnType<typeof drawn> {
  return drawn({
    slice,
    proof: passedProof,
    built: { outcome: "built" },
    builtAt: "round-1",
    work: "forge/P1-tests-3",
    kept: "with-tests",
    caseMessages: "filtered",
    into: "integration",
    rounds,
  });
}

function judgedOf(lines: readonly CardLine[]): readonly CardLine[] {
  return lines.filter((line) => line.mark === "judged");
}

test("a reviewer's not held never withholds merge, and its lines are marked judged, never computed", () => {
  const state = { ...reviewed({ ...proved, round: 3 }, [forBuilder]), reviewedAt: "review-3" };
  const result = cardOf(roundsOnCard(state));
  assert.equal(result.merge, true);
  assert.equal(result.card.withheld.merge, undefined);
  const judged = judgedOf(result.card.lines);
  assert.ok(judged.length >= 4);
  assert.ok(judged.every((line) => line.source.step === "review-3"));
  const rounds = result.card.lines.find((line) => line.words.startsWith("rounds:"));
  assert.deepEqual(rounds, {
    mark: "computed",
    words: "rounds: 3 of at most 3; no more may run",
    source: { step: "draw" },
  });
});

test("a long reason is one judged line, its words whole and in order", () => {
  const long = { item: "DOD-P1-2", held: false as const, why: `${"word ".repeat(30)}end.` };
  const state = reviewedState(
    proved,
    { plan: "review", review: { conditions: [long], findings: [] }, remaining: [] },
    "review-1",
  );
  const judged = judgedOf(cardOf(roundsOnCard(state)).card.lines);
  assert.deepEqual(
    judged.map((line) => line.words),
    [`DOD-P1-2 not held: ${"word ".repeat(30)}end.`, "no finding remains"],
  );
});

test("the card says why the rounds ended: a leak, a stopped builder, no findings, or the third round", () => {
  const ended = (state: RoundsState): string => roundsOnCard(state).ended;
  const leak = { kind: "mark-in-answer" as const };
  const stoppedBuild = { outcome: "stopped" as const, missing: { lacks: "kernel" as const, name: "x" } };
  assert.equal(ended(reviewedState({ ...proved, leaks: [leak] }, { plan: "leaked" }, "review-1")), "leak");
  assert.equal(ended(reviewedState({ ...proved, built: stoppedBuild }, { plan: "stopped" }, "review-1")), "stopped");
  assert.equal(ended(reviewed(proved, [])), "no-findings");
  assert.equal(ended(reviewed({ ...proved, round: 3 }, [])), "no-findings");
  assert.equal(ended(reviewed({ ...proved, round: 3 }, [forTests])), "last-round");
  const leakAfterReview = { ...reviewed(proved, []), leaks: [leak] };
  assert.equal(ended(leakAfterReview), "leak");
  const words = (state: RoundsState): string | undefined =>
    cardOf(roundsOnCard(state)).card.lines.find((line) => line.words.startsWith("rounds:"))?.words;
  assert.equal(
    words(reviewedState({ ...proved, leaks: [leak] }, { plan: "leaked" }, "review-1")),
    "rounds: 1 of at most 3; a leak ended them",
  );
  assert.equal(words(reviewed(proved, [])), "rounds: 1 of at most 3; the reviewer had no findings");
});
