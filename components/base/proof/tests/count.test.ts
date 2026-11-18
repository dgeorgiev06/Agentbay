import assert from "node:assert/strict";
import { test } from "node:test";
import { countParts, type CountEvidence } from "../scripts/kinds/count.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

function judged(evidence: CountEvidence): Verdict {
  return verdictOf("count", "count", countParts(evidence));
}

const notCounted =
  "Counting at the head ended with the exit code 2: a path to count in does not exist or could not be read.";

test("count: passed when the head has exactly the most", () => {
  assert.deepEqual(judged({ found: "most", most: 2, head: { known: true, lines: 2 } }), {
    item: "count",
    kind: "count",
    verdict: "passed",
    detail: "2 lines hold the counted text at the head, and at most 2 may.",
  });
});

test("count: failed when the head has one more than the most, and the detail gives both numbers", () => {
  assert.deepEqual(judged({ found: "most", most: 2, head: { known: true, lines: 3 } }), {
    item: "count",
    kind: "count",
    verdict: "failed",
    detail: "3 lines hold the counted text at the head, and at most 2 may.",
  });
});

test("count: a most of zero passes with no line and fails with one", () => {
  assert.equal(judged({ found: "most", most: 0, head: { known: true, lines: 0 } }).verdict, "passed");
  assert.deepEqual(judged({ found: "most", most: 0, head: { known: true, lines: 1 } }), {
    item: "count",
    kind: "count",
    verdict: "failed",
    detail: "1 line holds the counted text at the head, and at most 0 may.",
  });
});

test("count: passed when the head has as many as the base", () => {
  const evidence: CountEvidence = {
    found: "no rise",
    base: { known: true, lines: 26 },
    head: { known: true, lines: 26 },
  };
  assert.deepEqual(judged(evidence), {
    item: "count",
    kind: "count",
    verdict: "passed",
    detail: "26 lines hold the counted text at the head, and 26 at the base.",
  });
});

test("count: passed when the head has fewer than the base", () => {
  const evidence: CountEvidence = {
    found: "no rise",
    base: { known: true, lines: 26 },
    head: { known: true, lines: 1 },
  };
  assert.deepEqual(judged(evidence), {
    item: "count",
    kind: "count",
    verdict: "passed",
    detail: "1 line holds the counted text at the head, and 26 at the base.",
  });
});

test("count: failed when the head has one more than the base", () => {
  const evidence: CountEvidence = {
    found: "no rise",
    base: { known: true, lines: 26 },
    head: { known: true, lines: 27 },
  };
  assert.deepEqual(judged(evidence), {
    item: "count",
    kind: "count",
    verdict: "failed",
    detail: "27 lines hold the counted text at the head, more than the 26 at the base.",
  });
});

test("count: inconclusive when the head is not counted, whatever the most", () => {
  assert.deepEqual(
    judged({
      found: "most",
      most: 5,
      head: { known: false, reason: notCounted },
    }),
    {
      item: "count",
      kind: "count",
      verdict: "inconclusive",
      reason: notCounted,
    },
  );
});

test("count: inconclusive when either side of a count that may not rise is not counted, and both reasons are given", () => {
  const baseReason = "No copy of base could be made: The commit is not known.";
  const headOnly: CountEvidence = {
    found: "no rise",
    base: { known: true, lines: 9 },
    head: { known: false, reason: notCounted },
  };
  const baseOnly: CountEvidence = {
    found: "no rise",
    base: { known: false, reason: baseReason },
    head: { known: true, lines: 0 },
  };
  const both: CountEvidence = {
    found: "no rise",
    base: { known: false, reason: baseReason },
    head: { known: false, reason: notCounted },
  };
  assert.deepEqual(judged(headOnly), {
    item: "count",
    kind: "count",
    verdict: "inconclusive",
    reason: notCounted,
  });
  assert.deepEqual(judged(baseOnly), {
    item: "count",
    kind: "count",
    verdict: "inconclusive",
    reason: baseReason,
  });
  assert.deepEqual(judged(both), {
    item: "count",
    kind: "count",
    verdict: "inconclusive",
    reason: `${notCounted} ${baseReason}`,
  });
});

test("count: inconclusive when the item uses a count the project does not declare", () => {
  assert.deepEqual(judged({ found: "not declared", name: "debt" }), {
    item: "count",
    kind: "count",
    verdict: "inconclusive",
    reason: "The project declares no count named debt in proof's settings, so nothing is known.",
  });
});
