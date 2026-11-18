import { endedOf, type Finished } from "./commands.ts";
import { failedTestNames, summaryOf, type Summary } from "./tap.ts";

type Shown = {
  readonly seconds: number;
  readonly stdout: string;
  readonly stderr: string;
};

type Counted = Shown & {
  readonly passed: number;
  readonly failed: number;
  readonly failedTests: readonly string[];
};

export type TestResult =
  | (Counted & { readonly verdict: "passed" })
  | (Counted & { readonly verdict: "failed" })
  | (Shown & { readonly verdict: "inconclusive"; readonly reason: string });

type Reading =
  | { readonly kind: "unknown"; readonly reason: string }
  | { readonly kind: "counted"; readonly exitCode: number; readonly summary: Summary };

export const testRunSubject = "The test run";

function readingOf(finished: Finished, timeLimitSeconds: number): Reading {
  const ended = endedOf(testRunSubject, finished, timeLimitSeconds);
  if (ended.kind === "unfinished") {
    return { kind: "unknown", reason: ended.reason };
  }
  const summary = summaryOf(finished.stdout);
  if (summary === undefined) {
    const reason = "The output ended without a summary of the tests, so the mode cannot tell whether they passed.";
    return { kind: "unknown", reason };
  }
  if (summary.tests === 0) {
    return { kind: "unknown", reason: "The run reported no tests, so nothing was tested." };
  }
  return { kind: "counted", exitCode: ended.exitCode, summary };
}

function unreadReason(exitCode: number, summary: Summary): string {
  return (
    `The test run ended with exit code ${String(exitCode)}, ${String(summary.pass)} passed, ` +
    `${String(summary.fail)} failed and ${String(summary.cancelled)} cancelled, ` +
    "which the mode does not read as passed or failed."
  );
}

export function testResult(finished: Finished, timeLimitSeconds: number): TestResult {
  const shown = { seconds: finished.seconds, stdout: finished.stdout, stderr: finished.stderr };
  const reading = readingOf(finished, timeLimitSeconds);
  if (reading.kind === "unknown") {
    return { ...shown, verdict: "inconclusive", reason: reading.reason };
  }
  const { exitCode, summary } = reading;
  const counts = { passed: summary.pass, failed: summary.fail };
  if (exitCode === 1 && summary.fail > 0) {
    return { ...shown, ...counts, verdict: "failed", failedTests: failedTestNames(finished.stdout) };
  }
  if (exitCode === 0 && summary.fail === 0 && summary.cancelled === 0 && summary.pass > 0) {
    return { ...shown, ...counts, verdict: "passed", failedTests: [] };
  }
  return { ...shown, verdict: "inconclusive", reason: unreadReason(exitCode, summary) };
}
