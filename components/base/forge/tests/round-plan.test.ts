import assert from "node:assert/strict";
import { test } from "node:test";
import { drawn, sliceOf, type CardLine } from "../scripts/lib/cards.ts";
import type { Failing } from "../scripts/lib/failing.ts";
import type { Finding } from "../scripts/lib/review.ts";
import { roundsOnCard } from "../scripts/lib/round-card.ts";
import { reviewedState, reviewPlan, roundPlan, type RoundsState } from "../scripts/lib/rounds.ts";

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
  judgement: [],
  size: [],
};

function reviewed(state: RoundsState, findings: readonly Finding[]): RoundsState {
  return reviewedState(state, { plan: "review", review: { conditions: [held, notHeld], findings } }, "review-1");
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
  assert.deepEqual(third.remaining, [{ to: "test-writer", case: "a quill is counted", question: "Q2" }]);
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
    judged: {
      step: "review-3",
      sentences: [
        "DOD-P1-1 held by 1 case",
        "DOD-P1-2 not held: No case refuses an empty quill.",
        "2 findings remain: 1 for the builder, 1 for the test writer",
        "for the builder, P-05: a quill is counted",
        "for the test writer, Q2: a quill is counted",
      ],
    },
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
  assert.deepEqual(roundsOnCard({ ...proved, stage: "reviewed", round: 2 }), { count: 2, most: 3 });
});

function cardOf(rounds: ReturnType<typeof roundsOnCard>): ReturnType<typeof drawn> {
  return drawn({
    slice,
    proof: passedProof,
    built: { outcome: "built" },
    work: "forge/P1-tests-3",
    kept: "with-tests",
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
  const words = result.card.lines.map((line) => line.words);
  assert.ok(words.includes("rounds: 3 of at most 3"));
  const rounds = result.card.lines.find((line) => line.words === "rounds: 3 of at most 3");
  assert.deepEqual(rounds, { mark: "computed", words: "rounds: 3 of at most 3", source: { step: "draw" } });
  assert.ok(judged.every((line) => Array.from(line.words).length <= 35));
});

test("a long reason is wrapped into judged lines of at most 35 columns, none dropped", () => {
  const long = { item: "DOD-P1-2", held: false as const, why: `${"word ".repeat(30)}end.` };
  const state = reviewedState(proved, { plan: "review", review: { conditions: [long], findings: [] } }, "review-1");
  const judged = judgedOf(cardOf(roundsOnCard(state)).card.lines);
  assert.ok(judged.every((line) => Array.from(line.words).length <= 35));
  assert.equal(
    judged.map((line) => line.words).join(" "),
    `DOD-P1-2 not held: ${"word ".repeat(30)}end. no finding remains`,
  );
});
