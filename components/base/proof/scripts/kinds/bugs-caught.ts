import { broken, counted, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";
import { testRun, type Cases, type TestRun } from "../lib/toolchain.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";
import type { Bug, Request } from "../lib/request.ts";

export type BugRun =
  | { readonly how: "no copy"; readonly reason: string }
  | { readonly how: "not applied"; readonly reason: string }
  | { readonly how: "ran"; readonly run: TestRun };

export type BugEvidence = { readonly name: string; readonly run: BugRun };

function filesThatDidNotLoadAlone(cases: Cases): number {
  const failing = (cases.failures?.length ?? 0) + (cases.failuresNotListed ?? 0);
  return failing === 0 ? (cases.notLoaded?.length ?? 0) : 0;
}

function caughtPart(name: string, cases: Cases): Part {
  const notLoaded = filesThatDidNotLoadAlone(cases);
  if (notLoaded === 0) {
    return held;
  }
  const files = counted(notLoaded, "test file", "test files");
  return unknown(`The tests of the bug ${name} did not run: ${files} did not load, and no case failed.`);
}

function runPart(name: string, run: TestRun): Part {
  switch (run.ran) {
    case "failed":
      return caughtPart(name, run.cases);
    case "passed":
      return broken(`A bug survived: ${name}.`);
    case "inconclusive":
      return unknown(`The run with the bug ${name} is not known: ${run.reason}`);
    case "not started":
      return unknown(`The run with the bug ${name} could not start: ${run.reason}`);
  }
}

function bugPart(bug: BugEvidence): Part {
  switch (bug.run.how) {
    case "no copy":
      return unknown(bug.run.reason);
    case "not applied":
      return unknown(`The bug ${bug.name} could not be applied to the head: ${bug.run.reason}`);
    case "ran":
      return runPart(bug.name, bug.run.run);
  }
}

export function bugsCaughtParts(bugs: readonly BugEvidence[]): Parts {
  const [first, ...rest] = bugs.map(bugPart);
  if (first === undefined) {
    return { parts: [unknown("No bugs were given to inject, so nothing is known.")], whenPassed: "" };
  }
  const all = String(bugs.length);
  return { parts: [first, ...rest], whenPassed: `Every injected bug was caught: ${all} of ${all}.` };
}

async function bugRun(step: ProofStep, head: string, bug: Bug): Promise<BugRun> {
  return inCopy(step, head, async (copy) => {
    if (!copy.made) {
      return { how: "no copy", reason: copy.reason };
    }
    const applied = await step.called("worktrees.apply", { folder: copy.folder, patch: bug.patch });
    if (!applied.ok) {
      return { how: "not applied", reason: applied.reason };
    }
    return { how: "ran", run: await testRun(step, copy.folder, bug.tests) };
  });
}

export async function bugsCaughtEvidence(step: ProofStep, request: Request): Promise<readonly BugEvidence[]> {
  const bugs: BugEvidence[] = [];
  for (const bug of request.bugs) {
    bugs.push({ name: bug.name, run: await bugRun(step, request.head, bug) });
  }
  return bugs;
}

export async function proveBugsCaught(step: ProofStep, request: Request): Promise<Parts> {
  return bugsCaughtParts(await bugsCaughtEvidence(step, request));
}
