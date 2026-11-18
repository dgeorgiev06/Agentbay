import assert from "node:assert/strict";
import { test } from "node:test";
import { bugsCaughtParts, type BugEvidence } from "../scripts/kinds/bugs-caught.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

function judged(bugs: readonly BugEvidence[]): Verdict {
  return verdictOf("bugs", "bugs-caught", bugsCaughtParts(bugs));
}

function caught(name: string): BugEvidence {
  return { name, run: { how: "ran", run: { ran: "failed", failed: 2 } } };
}

function survived(name: string): BugEvidence {
  return { name, run: { how: "ran", run: { ran: "passed", passed: 3 } } };
}

test("bugs-caught: passed when the run of the one bug failed", () => {
  assert.deepEqual(judged([caught("the value is not raised")]), {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "passed",
    detail: "Every injected bug was caught: 1 of 1.",
  });
});

test("bugs-caught: passed when the run of every bug failed, and the detail counts them", () => {
  assert.deepEqual(judged([caught("the value is not raised"), caught("the name is lost")]), {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "passed",
    detail: "Every injected bug was caught: 2 of 2.",
  });
});

test("bugs-caught: failed when the run of the one bug passed, and the bug is named", () => {
  assert.deepEqual(judged([survived("the name is lost")]), {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "failed",
    detail: "A bug survived: the name is lost.",
  });
});

test("bugs-caught: of two bugs, only the one whose run passed is named, wherever it stands", () => {
  const cases = [
    [survived("the name is lost"), caught("the value is not raised")],
    [caught("the value is not raised"), survived("the name is lost")],
  ];
  for (const bugs of cases) {
    assert.deepEqual(judged(bugs), {
      item: "bugs",
      kind: "bugs-caught",
      verdict: "failed",
      detail: "A bug survived: the name is lost.",
    });
  }
});

test("bugs-caught: every bug that survived is named", () => {
  assert.deepEqual(judged([survived("the name is lost"), survived("the value is not raised")]), {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "failed",
    detail: "A bug survived: the name is lost. A bug survived: the value is not raised.",
  });
});

test("bugs-caught: inconclusive with no bugs at all", () => {
  assert.deepEqual(judged([]), {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "inconclusive",
    reason: "No bugs were given to inject, so nothing is known.",
  });
});

test("bugs-caught: a bug whose patch does not apply is never caught, alone or beside a caught bug and a survivor", () => {
  const stale: BugEvidence = {
    name: "the patch is stale",
    run: { how: "not applied", reason: "patch failed" },
  };
  const reason = "The bug the patch is stale could not be applied to the head, so it touched nothing: patch failed";
  for (const bugs of [[stale], [caught("the value is not raised"), stale, survived("the name is lost")]]) {
    assert.deepEqual(judged(bugs), {
      item: "bugs",
      kind: "bugs-caught",
      verdict: "inconclusive",
      reason,
    });
  }
});

test("bugs-caught: a run stopped at its limit, a run that could not start, and a copy not made are never caught", () => {
  const cases: readonly (readonly [BugEvidence, string])[] = [
    [
      {
        name: "the value waits",
        run: {
          how: "ran",
          run: { ran: "inconclusive", reason: "It was stopped." },
        },
      },
      "The run with the bug the value waits is not known: It was stopped.",
    ],
    [
      {
        name: "the value waits",
        run: {
          how: "ran",
          run: { ran: "not started", reason: "No time left." },
        },
      },
      "The run with the bug the value waits could not start: No time left.",
    ],
    [
      {
        name: "the value waits",
        run: { how: "no copy", reason: "No copy of head could be made: gone." },
      },
      "No copy of head could be made: gone.",
    ],
  ];
  for (const [unknownBug, reason] of cases) {
    for (const bugs of [[unknownBug], [caught("the value is not raised"), unknownBug]]) {
      assert.deepEqual(judged(bugs), {
        item: "bugs",
        kind: "bugs-caught",
        verdict: "inconclusive",
        reason,
      });
    }
  }
});
