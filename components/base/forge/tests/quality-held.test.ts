import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import type { CardLine } from "../scripts/lib/card-lines.ts";
import { drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import { mustNotHeld, reviewedPracticeLines } from "../scripts/lib/practices-block.ts";
import { judgedPractices, type JudgedPractices } from "../scripts/lib/reviewer-practices.ts";
import type { RoundsOnCard } from "../scripts/lib/round-card.ts";
import { sliceOf } from "../scripts/lib/slice-form.ts";
import { withToolChecks } from "../scripts/lib/tool-checks.ts";

const twelve = "The same code or rule lives in one place (ADR 11).";

const twoNotHeld: JudgedPractices = {
  tally: { held: 40, notHeld: 2, doesNotApply: 3 },
  notHeld: [
    {
      id: "P-12",
      says: twelve,
      path: "components/modes/q1/scripts/count.ts",
      sentence: "The count rule is written twice.",
    },
    { id: "P-48", says: "A query names its columns and carries a limit.", path: "components/modes/q1/tests/q.test.ts" },
  ],
  checks: 12,
};

function roundsWith(practices: JudgedPractices | undefined): RoundsOnCard {
  const judged = { step: "review-2", round: 2, sentences: ["no finding remains"] };
  return {
    count: 2,
    most: 3,
    ended: "no-findings",
    judged: practices === undefined ? judged : { ...judged, practices },
  };
}

const slice: Json = {
  name: "Q1",
  kind: "mode",
  scope: ["components/modes/q1/**"],
  after: [],
  done: [{ id: "DOD-Q1-1", says: "A quill is counted.", level: "must", proof: { kind: "fails-first", tests: [] } }],
};

function mergeInput(changes: Partial<MergeCardInput>): MergeCardInput {
  return {
    slice: sliceOf(slice),
    proof: {
      verdicts: [
        { item: "DOD-Q1-1", kind: "fails-first", verdict: "passed", detail: "It held." },
        { item: "scope", kind: "in-scope", verdict: "passed", detail: "In scope." },
        { item: "declared", kind: "as-declared", verdict: "passed", detail: "As declared." },
      ],
      size: [],
    },
    built: { outcome: "built" },
    builtAt: "round-2",
    work: "forge/Q1-tests-2",
    kept: "with-tests",
    caseMessages: "filtered",
    into: "integration",
    ...changes,
  };
}

function wordsOf(lines: readonly CardLine[]): readonly string[] {
  return lines.map((line) => line.words);
}

describe("the checks item forge adds", () => {
  test("a slice whose plan lists no checks item gets one, must, that says forge added it", () => {
    const added = sliceOf(withToolChecks(slice)).done.at(-1);
    assert.deepEqual(added, {
      id: "checks",
      says:
        "Added by forge, as the plan lists no checks item: the toolchain's checks, such as types, lint, format and " +
        "dead code, and its whole test run pass.",
      level: "must",
      proof: { kind: "checks" },
    });
  });

  test("a slice that lists a checks item is left as it is, and an item already named checks keeps its name", () => {
    const listed = {
      ...sliceOf(slice),
      done: [{ id: "DOD-Q1-2", says: "Checks.", level: "must", proof: { kind: "checks" } }],
    };
    assert.deepEqual(withToolChecks(listed), listed);
    const named = { ...sliceOf(slice), done: [{ id: "checks", says: "Judged.", level: "should" }] };
    assert.deepEqual(
      sliceOf(withToolChecks(named)).done.map((item) => item.id),
      ["checks", "forge-checks"],
    );
  });

  test("the added item with no verdict from proof is not known, so merge is withheld", () => {
    const merge = drawn(mergeInput({ slice: sliceOf(withToolChecks(slice)) }));
    assert.equal(merge.card.withheld.merge, "1 must item is not known.");
    assert.ok(wordsOf(merge.card.lines).some((words) => words.startsWith("checks, must, not known: Added by forge")));
  });
});

describe("the practices block of the merge card", () => {
  test("one-slice draws no block, rounds with no review say the practices were not judged", () => {
    assert.deepEqual(reviewedPracticeLines(undefined, []), []);
    assert.deepEqual(reviewedPracticeLines({ count: 1, most: 3, ended: "leak" }, []), [
      {
        mark: "computed",
        words: "practices: not judged, since the rounds ended with no review",
        source: { step: "draw" },
      },
    ]);
  });

  test("the counts are one computed line; each practice not held is a judged line of the last review", () => {
    const lines = reviewedPracticeLines(roundsWith(twoNotHeld), ["P-12"]);
    assert.deepEqual(
      lines.map((line) => [line.mark, line.source.step]),
      [
        ["computed", "draw"],
        ["judged", "review-2"],
        ["judged", "review-2"],
      ],
    );
    assert.deepEqual(wordsOf(lines), [
      "practices answered by the reviewer in round 2: 45; 40 held, 2 not held, 3 do not apply; a check holds 12 more",
      `P-12, must, not held: ${twelve} In components/modes/q1/scripts/ count.ts: The count rule is written twice.`,
      "P-48, not held: A query names its columns and carries a limit. In components/modes/q1/tests/ q.test.ts: " +
        "kept from the card: it quotes a test",
    ]);
  });

  test("a must practice not held withholds merge, naming it; one not marked must withholds nothing", () => {
    const rounds = roundsWith(twoNotHeld);
    assert.deepEqual(mustNotHeld(rounds, ["P-12", "TS-21"]), ["P-12"]);
    assert.deepEqual(mustNotHeld(rounds, ["TS-21"]), []);
    const withheld = drawn(mergeInput({ rounds, mustPractices: ["P-12", "P-48"] }));
    assert.equal(withheld.merge, false);
    assert.equal(
      withheld.card.withheld.merge,
      "The reviewer answered P-12 and P-48 not held, and the project marks them must.",
    );
    assert.deepEqual(Object.keys(withheld.card.withheld), ["merge", "send-back", "discard"]);
    assert.equal(drawn(mergeInput({ rounds, mustPractices: ["TS-21"] })).merge, true);
    assert.equal(drawn(mergeInput({ rounds })).merge, true);
  });

  test("a review's answers keep the not-held practices with their sentences, unless a sentence quotes a test", () => {
    const tests = ['test("a quill is counted", () => count("ABCDEFGHIJKLMNOPQRSTUVWXYZ") === 1);'];
    const practices = [
      { id: "P-12", says: twelve },
      { id: "P-48", says: "A query names its columns." },
    ];
    const judged = judgedPractices(
      [
        { id: "P-12", answer: "not-held", sentence: "The rule is twice.", path: "a.ts" },
        { id: "P-48", answer: "not-held", sentence: "It counts ABCDEFGHIJKLMNOPQRSTUVWXYZ.", path: "q.test.ts" },
        { id: "P-05", answer: "held", sentence: "Fine." },
        { id: "P-50", answer: "does-not-apply", sentence: "No database." },
      ],
      { practices, tests, checks: 3 },
    );
    assert.deepEqual(judged, {
      tally: { held: 1, notHeld: 2, doesNotApply: 1 },
      notHeld: [
        { id: "P-12", says: twelve, path: "a.ts", sentence: "The rule is twice." },
        { id: "P-48", says: "A query names its columns.", path: "q.test.ts" },
      ],
      checks: 3,
    });
    assert.deepEqual(judgedPractices([], { practices, tests: [], checks: 0 }).notHeld, []);
  });
});
