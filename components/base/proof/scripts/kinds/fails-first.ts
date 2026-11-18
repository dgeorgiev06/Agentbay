import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import type { ProofOf, Request } from "../lib/request.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";
import { testRun, type TestRun } from "../lib/toolchain.ts";
import { broken, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";

export type BaseRun =
  | { readonly how: "no copy"; readonly reason: string }
  | { readonly how: "not laid over"; readonly reason: string }
  | { readonly how: "ran"; readonly run: TestRun };

export type HeadRun =
  { readonly how: "no copy"; readonly reason: string } | { readonly how: "ran"; readonly run: TestRun };

export type FailsFirstEvidence =
  | { readonly found: "missing at the head"; readonly paths: readonly string[] }
  | { readonly found: "runs"; readonly base: BaseRun; readonly head: HeadRun };

type BaseFound = { readonly missing: readonly string[] } | { readonly run: BaseRun };

const whenPassed = "The named tests failed on the base with them laid over it, and pass on the head.";

function runPart(run: TestRun, on: "base" | "head"): Part {
  switch (run.ran) {
    case "passed":
      return on === "base" ? broken("The named tests already pass on the base, so they do not show the change.") : held;
    case "failed":
      return on === "base" ? held : broken("The named tests fail on the head.");
    case "inconclusive":
      return unknown(`The run on the ${on} is not known: ${run.reason}`);
    case "not started":
      return unknown(`The run on the ${on} could not start: ${run.reason}`);
  }
}

function basePart(base: BaseRun): Part {
  switch (base.how) {
    case "no copy":
      return unknown(base.reason);
    case "not laid over":
      return unknown(`The named tests could not be laid over the base: ${base.reason}`);
    case "ran":
      return runPart(base.run, "base");
  }
}

function headPart(head: HeadRun): Part {
  return head.how === "no copy" ? unknown(head.reason) : runPart(head.run, "head");
}

export function failsFirstParts(evidence: FailsFirstEvidence): Parts {
  if (evidence.found === "missing at the head") {
    const paths = evidence.paths.join(", ");
    const said = `These test files do not exist at the head, so they cannot show the change: ${paths}.`;
    return { parts: [broken(said)], whenPassed };
  }
  return { parts: [basePart(evidence.base), headPart(evidence.head)], whenPassed };
}

function removedOf(value: Json): readonly string[] {
  const removed = fieldsOf(value).removed;
  return Array.isArray(removed) ? removed.filter((path) => typeof path === "string") : [];
}

async function baseFound(step: ProofStep, request: Request, tests: readonly string[]): Promise<BaseFound> {
  return inCopy(step, request.base, async (copy) => {
    if (!copy.made) {
      return { run: { how: "no copy", reason: copy.reason } };
    }
    const laid = await step.called("worktrees.overlay", { folder: copy.folder, commit: request.head, paths: tests });
    if (!laid.ok) {
      return { run: { how: "not laid over", reason: laid.reason } };
    }
    const missing = removedOf(laid.value);
    return missing.length > 0 ? { missing } : { run: { how: "ran", run: await testRun(step, copy.folder, tests) } };
  });
}

async function headRun(step: ProofStep, request: Request, tests: readonly string[]): Promise<HeadRun> {
  return inCopy(step, request.head, async (copy) =>
    copy.made ? { how: "ran", run: await testRun(step, copy.folder, tests) } : { how: "no copy", reason: copy.reason },
  );
}

export async function failsFirstEvidence(
  step: ProofStep,
  request: Request,
  tests: readonly string[],
): Promise<FailsFirstEvidence> {
  const base = await baseFound(step, request, tests);
  if ("missing" in base) {
    return { found: "missing at the head", paths: base.missing };
  }
  return { found: "runs", base: base.run, head: await headRun(step, request, tests) };
}

export async function proveFailsFirst(
  step: ProofStep,
  request: Request,
  proof: ProofOf<"fails-first">,
): Promise<Parts> {
  return failsFirstParts(await failsFirstEvidence(step, request, proof.tests));
}
