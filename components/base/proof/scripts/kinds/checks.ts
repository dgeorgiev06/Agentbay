import type { Request } from "../lib/request.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";
import { checkCount, checkRun, testRun, type CheckRun, type CheckVerdict, type TestRun } from "../lib/toolchain.ts";
import { broken, brokenWithCases, counted, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";

export type ChecksEvidence =
  | { readonly copy: "not made"; readonly reason: string }
  | { readonly copy: "made"; readonly checks: CheckRun; readonly tests: TestRun };

function checkPart(check: CheckVerdict): Part {
  switch (check.verdict) {
    case "passed":
      return held;
    case "failed":
      return broken(`The check ${check.name} found a fault.`);
    case "inconclusive":
      return unknown(`The check ${check.name} is not known: ${check.reason}`);
  }
}

function checkParts(checks: CheckRun): readonly [Part, ...Part[]] {
  if (checks.ran === "not started") {
    return [unknown(`The checks could not start: ${checks.reason}`)];
  }
  const [first, ...rest] = checks.verdicts.map(checkPart);
  return first === undefined ? [unknown("The toolchain ran no checks, so nothing is known.")] : [first, ...rest];
}

function testPart(tests: TestRun): Part {
  switch (tests.ran) {
    case "passed":
      return held;
    case "failed":
      return brokenWithCases(`${counted(tests.failed, "test", "tests")} failed.`, tests.cases);
    case "inconclusive":
      return unknown(`The test run is not known: ${tests.reason}`);
    case "not started":
      return unknown(`The test run could not start: ${tests.reason}`);
  }
}

function whenPassed(evidence: ChecksEvidence): string {
  if (evidence.copy === "not made" || evidence.checks.ran === "not started" || evidence.tests.ran !== "passed") {
    return "";
  }
  const names = evidence.checks.verdicts.map((check) => check.name).join(", ");
  return `Every check passed (${names}), and so did the test run: ${counted(evidence.tests.passed, "test", "tests")}.`;
}

export function checksParts(evidence: ChecksEvidence): Parts {
  if (evidence.copy === "not made") {
    return { parts: [unknown(evidence.reason)], whenPassed: "" };
  }
  return { parts: [...checkParts(evidence.checks), testPart(evidence.tests)], whenPassed: whenPassed(evidence) };
}

export async function checksEvidence(step: ProofStep, head: string): Promise<ChecksEvidence> {
  const sharing = (await checkCount(step)) ?? 1;
  return inCopy(step, head, async (copy) => {
    if (!copy.made) {
      return { copy: "not made", reason: copy.reason };
    }
    const checks = await checkRun(step, copy.folder, sharing);
    const tests = await testRun(step, copy.folder);
    return { copy: "made", checks, tests };
  });
}

export async function proveChecks(step: ProofStep, request: Request): Promise<Parts> {
  return checksParts(await checksEvidence(step, request.head));
}
