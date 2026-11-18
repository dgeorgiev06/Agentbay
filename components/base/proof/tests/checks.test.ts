import assert from "node:assert/strict";
import { test } from "node:test";
import { checksParts, type ChecksEvidence } from "../scripts/kinds/checks.ts";
import type { CheckRun, TestRun } from "../scripts/lib/toolchain.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

const stopped = "It did not finish within its time limit and was stopped.";

const allPassed: CheckRun = {
  ran: "ended",
  verdicts: [
    { name: "format", verdict: "passed" },
    { name: "lint", verdict: "passed" },
  ],
};

const ninePassed: TestRun = { ran: "passed", passed: 9 };

function judged(evidence: ChecksEvidence): Verdict {
  return verdictOf("DOD-1", "checks", checksParts(evidence));
}

function checked(checks: CheckRun, tests: TestRun): Verdict {
  return judged({ copy: "made", checks, tests });
}

function failedWith(detail: string): Verdict {
  return { item: "DOD-1", kind: "checks", verdict: "failed", detail };
}

function inconclusiveWith(reason: string): Verdict {
  return { item: "DOD-1", kind: "checks", verdict: "inconclusive", reason };
}

test("checks: every check and the test run passed is passed, and the detail names the checks and counts the tests", () => {
  assert.deepEqual(checked(allPassed, ninePassed), {
    item: "DOD-1",
    kind: "checks",
    verdict: "passed",
    detail: "Every check passed (format, lint), and so did the test run: 9 tests.",
  });
});

test("checks: a check that found a fault and a failed test run are failed, naming the check and counting the tests", () => {
  const lintFails: CheckRun = {
    ran: "ended",
    verdicts: [
      { name: "format", verdict: "passed" },
      { name: "lint", verdict: "failed" },
    ],
  };
  assert.deepEqual(
    checked(lintFails, { ran: "failed", failed: 1 }),
    failedWith("The check lint found a fault. 1 test failed."),
  );
  assert.deepEqual(checked(lintFails, ninePassed), failedWith("The check lint found a fault."));
});

test("checks: every check passed and a failed test run is failed", () => {
  assert.deepEqual(checked(allPassed, { ran: "failed", failed: 2 }), failedWith("2 tests failed."));
});

test("checks: a check stopped at its limit beside checks that passed is inconclusive, never passed", () => {
  const typesStopped: CheckRun = {
    ran: "ended",
    verdicts: [
      { name: "format", verdict: "passed" },
      { name: "types", verdict: "inconclusive", reason: stopped },
    ],
  };
  assert.deepEqual(checked(typesStopped, ninePassed), inconclusiveWith(`The check types is not known: ${stopped}`));
});

test("checks: a check stopped at its limit beside a check that found a fault is inconclusive, and the fault is not shown", () => {
  const mixed: CheckRun = {
    ran: "ended",
    verdicts: [
      { name: "lint", verdict: "failed" },
      { name: "types", verdict: "inconclusive", reason: stopped },
    ],
  };
  assert.deepEqual(
    checked(mixed, { ran: "failed", failed: 3 }),
    inconclusiveWith(`The check types is not known: ${stopped}`),
  );
});

test("checks: a check the project is not set up for is inconclusive with the toolchain's sentence whole, never failed", () => {
  const notSetUp =
    "The project's package.json has no script deadcode; add one that runs the project's dead-code check.";
  const lacking: CheckRun = {
    ran: "ended",
    verdicts: [
      { name: "lint", verdict: "passed" },
      { name: "deadcode", verdict: "inconclusive", reason: notSetUp },
    ],
  };
  assert.deepEqual(checked(lacking, ninePassed), inconclusiveWith(`The check deadcode is not known: ${notSetUp}`));
});

test("checks: a test run stopped at its limit, or one that could not start, is inconclusive with the reason given", () => {
  assert.deepEqual(
    checked(allPassed, { ran: "inconclusive", reason: stopped }),
    inconclusiveWith(`The test run is not known: ${stopped}`),
  );
  assert.deepEqual(
    checked(allPassed, { ran: "not started", reason: "The toolchain broke." }),
    inconclusiveWith("The test run could not start: The toolchain broke."),
  );
});

test("checks: checks that could not start, or a toolchain that ran none, are inconclusive", () => {
  assert.deepEqual(
    checked({ ran: "not started", reason: "The toolchain broke." }, ninePassed),
    inconclusiveWith("The checks could not start: The toolchain broke."),
  );
  assert.deepEqual(
    checked({ ran: "ended", verdicts: [] }, ninePassed),
    inconclusiveWith("The toolchain ran no checks, so nothing is known."),
  );
});

test("checks: a copy that could not be made is inconclusive with the reason worktrees gave", () => {
  const reason = "No copy of c9bb216 could be made: There is no commit c9bb216.";
  assert.deepEqual(judged({ copy: "not made", reason }), inconclusiveWith(reason));
});
