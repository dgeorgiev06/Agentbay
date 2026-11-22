import { pathMatch } from "../../../../../bay/sdk.ts";
import type { ProofOf, Request } from "../lib/request.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";
import {
  checkRun,
  describedToolchain,
  testRun,
  type CheckRun,
  type CheckVerdict,
  type Described,
  type TestRun,
} from "../lib/toolchain.ts";
import { broken, brokenWithCases, counted, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";

export type TestsRan = { readonly of: "every test" } | { readonly of: "chosen"; readonly files: number };

export type ChecksEvidence =
  | { readonly copy: "not made"; readonly reason: string }
  | { readonly copy: "made"; readonly checks: CheckRun; readonly tests: TestRun; readonly ran?: TestsRan };

type Chosen =
  | { readonly kind: "every test" }
  | { readonly kind: "files"; readonly files: readonly string[] }
  | { readonly kind: "none"; readonly reason: string };

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

function testRunWords(ran: TestsRan | undefined): string {
  if (ran?.of !== "chosen") {
    return "the test run";
  }
  return `the run of the ${counted(ran.files, "test file", "test files")} chosen from testsFrom`;
}

function whenPassed(evidence: ChecksEvidence): string {
  if (evidence.copy === "not made" || evidence.checks.ran === "not started" || evidence.tests.ran !== "passed") {
    return "";
  }
  const names = evidence.checks.verdicts.map((check) => check.name).join(", ");
  const tests = counted(evidence.tests.passed, "test", "tests");
  return `Every check passed (${names}), and so did ${testRunWords(evidence.ran)}: ${tests}.`;
}

export function checksParts(evidence: ChecksEvidence): Parts {
  if (evidence.copy === "not made") {
    return { parts: [unknown(evidence.reason)], whenPassed: "" };
  }
  return { parts: [...checkParts(evidence.checks), testPart(evidence.tests)], whenPassed: whenPassed(evidence) };
}

export function chosenTests(testsFrom: readonly string[] | undefined, described: Described | undefined): Chosen {
  if (testsFrom === undefined) {
    return { kind: "every test" };
  }
  if (described === undefined) {
    return { kind: "none", reason: "The toolchain did not say which files are tests, so none of testsFrom was run." };
  }
  const isTest = (path: string): boolean =>
    described.testFiles.some((pattern) => pathMatch(pattern, path).kind === "matched");
  const files = testsFrom.filter(isTest);
  if (files.length === 0) {
    const named = counted(testsFrom.length, "file", "files");
    return { kind: "none", reason: `None of the ${named} in testsFrom is a test file by the toolchain's patterns.` };
  }
  return { kind: "files", files };
}

async function testsOf(step: ProofStep, folder: string, chosen: Chosen): Promise<TestRun> {
  switch (chosen.kind) {
    case "every test":
      return testRun(step, folder);
    case "files":
      return testRun(step, folder, chosen.files);
    case "none":
      return { ran: "not started", reason: chosen.reason };
  }
}

function ranOf(chosen: Chosen): TestsRan {
  return chosen.kind === "files" ? { of: "chosen", files: chosen.files.length } : { of: "every test" };
}

export async function checksEvidence(
  step: ProofStep,
  head: string,
  testsFrom?: readonly string[],
): Promise<ChecksEvidence> {
  const described = await describedToolchain(step);
  const sharing = described?.checks ?? 1;
  const chosen = chosenTests(testsFrom, described);
  return inCopy(step, head, async (copy) => {
    if (!copy.made) {
      return { copy: "not made", reason: copy.reason };
    }
    const checks = await checkRun(step, copy.folder, sharing);
    const tests = await testsOf(step, copy.folder, chosen);
    return { copy: "made", checks, tests, ran: ranOf(chosen) };
  });
}

export async function proveChecks(step: ProofStep, request: Request, proof: ProofOf<"checks">): Promise<Parts> {
  return checksParts(await checksEvidence(step, request.head, proof.testsFrom));
}
