import assert from "node:assert/strict";
import { test } from "node:test";
import { checksParts, chosenTests, type ChecksEvidence } from "../scripts/kinds/checks.ts";
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
  assert.deepEqual(checked(lintFails, { ran: "failed", failed: 1, cases: {} }), {
    ...failedWith("The check lint found a fault. 1 test failed."),
    cases: {},
  });
  assert.deepEqual(checked(lintFails, ninePassed), failedWith("The check lint found a fault."));
});

test("checks: every check passed and a failed test run is failed", () => {
  assert.deepEqual(checked(allPassed, { ran: "failed", failed: 2, cases: {} }), {
    ...failedWith("2 tests failed."),
    cases: {},
  });
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
    checked(mixed, { ran: "failed", failed: 3, cases: {} }),
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

test("checks: a run of the test files chosen from testsFrom that passed is passed, and the detail says how many files ran", () => {
  const evidence: ChecksEvidence = {
    copy: "made",
    checks: allPassed,
    tests: ninePassed,
    ran: { of: "chosen", files: 3 },
  };
  assert.deepEqual(judged(evidence), {
    item: "DOD-1",
    kind: "checks",
    verdict: "passed",
    detail: "Every check passed (format, lint), and so did the run of the 3 test files chosen from testsFrom: 9 tests.",
  });
});

test("checks: testsFrom keeps only the files the toolchain's testFiles patterns hold, in their order", () => {
  const described = { checks: 5, testFiles: ["**/*.test.ts"] };
  const testsFrom = [
    "components/modes/todo/tests/todo.test.ts",
    "components/modes/todo/tests/fixture.json",
    "components/modes/todo/tests/deep/lists.test.ts",
    "components/modes/todo/tests/helpers.ts",
  ];
  assert.deepEqual(chosenTests(testsFrom, described), {
    kind: "files",
    files: ["components/modes/todo/tests/todo.test.ts", "components/modes/todo/tests/deep/lists.test.ts"],
  });
  assert.deepEqual(chosenTests(undefined, described), { kind: "every test" });
});

test("checks: testsFrom with no test file in it, or a toolchain that did not describe its tests, runs no test", () => {
  const described = { checks: 5, testFiles: ["**/*.test.ts"] };
  assert.deepEqual(chosenTests(["tests/fixture.json", "tests/helpers.ts"], described), {
    kind: "none",
    reason: "None of the 2 files in testsFrom is a test file by the toolchain's patterns.",
  });
  assert.deepEqual(chosenTests(["tests/a.test.ts"], undefined), {
    kind: "none",
    reason: "The toolchain did not say which files are tests, so none of testsFrom was run.",
  });
});
