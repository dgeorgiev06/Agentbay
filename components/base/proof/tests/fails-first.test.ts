import assert from "node:assert/strict";
import { test } from "node:test";
import { failsFirstParts, type BaseRun, type FailsFirstEvidence, type HeadRun } from "../scripts/kinds/fails-first.ts";
import type { TestRun } from "../scripts/lib/toolchain.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

const stopped = "It did not finish within its time limit and was stopped.";

const passedRun: TestRun = { ran: "passed", passed: 4 };

const failedRun: TestRun = { ran: "failed", failed: 2, cases: {} };

const onBaseAlready = "The named tests already pass on the base, so they do not show the change.";

function judged(evidence: FailsFirstEvidence): Verdict {
  return verdictOf("DOD-2", "fails-first", failsFirstParts(evidence));
}

function ran(base: BaseRun, head: HeadRun): Verdict {
  return judged({ found: "runs", base, head });
}

function on(run: TestRun): { readonly how: "ran"; readonly run: TestRun } {
  return { how: "ran", run };
}

function failedWith(detail: string): Verdict {
  return { item: "DOD-2", kind: "fails-first", verdict: "failed", detail };
}

function inconclusiveWith(reason: string): Verdict {
  return { item: "DOD-2", kind: "fails-first", verdict: "inconclusive", reason };
}

test("fails-first: failed on the base with the tests laid over it and passed on the head is passed", () => {
  assert.deepEqual(ran(on(failedRun), on(passedRun)), {
    item: "DOD-2",
    kind: "fails-first",
    verdict: "passed",
    detail: "The named tests failed on the base with them laid over it, and pass on the head.",
  });
});

test("fails-first: a run on the base that passed is failed with its own sentence, whatever the head did", () => {
  assert.deepEqual(ran(on(passedRun), on(passedRun)), failedWith(onBaseAlready));
  assert.deepEqual(ran(on(passedRun), on(failedRun)), {
    ...failedWith(`${onBaseAlready} The named tests fail on the head.`),
    cases: {},
  });
});

test("fails-first: tests that fail on the head too are failed", () => {
  assert.deepEqual(ran(on(failedRun), on(failedRun)), {
    ...failedWith("The named tests fail on the head."),
    cases: {},
  });
});

test("fails-first: a test file that does not exist at the head is failed with its own sentence, naming the file", () => {
  assert.deepEqual(
    judged({ found: "missing at the head", paths: ["tests/gone.test.ts"] }),
    failedWith("These test files do not exist at the head, so they cannot show the change: tests/gone.test.ts."),
  );
});

test("fails-first: a run on the base that could not start is inconclusive with its own sentence, though the head passed", () => {
  assert.deepEqual(
    ran(on({ ran: "not started", reason: "The toolchain broke." }), on(passedRun)),
    inconclusiveWith("The run on the base could not start: The toolchain broke."),
  );
});

test("fails-first: a run stopped at its limit beside a run that failed is inconclusive, and the failure is not shown", () => {
  assert.deepEqual(
    ran(on({ ran: "inconclusive", reason: stopped }), on(failedRun)),
    inconclusiveWith(`The run on the base is not known: ${stopped}`),
  );
  assert.deepEqual(
    ran(on(passedRun), on({ ran: "inconclusive", reason: stopped })),
    inconclusiveWith(`The run on the head is not known: ${stopped}`),
  );
});

test("fails-first: a copy that could not be made, or tests that could not be laid over the base, are inconclusive", () => {
  const noCopy = "No copy of 33cd559 could be made: There is no commit 33cd559.";
  assert.deepEqual(ran({ how: "no copy", reason: noCopy }, on(passedRun)), inconclusiveWith(noCopy));
  assert.deepEqual(
    ran({ how: "not laid over", reason: "The copy is gone." }, on(passedRun)),
    inconclusiveWith("The named tests could not be laid over the base: The copy is gone."),
  );
  assert.deepEqual(ran(on(failedRun), { how: "no copy", reason: noCopy }), inconclusiveWith(noCopy));
});
