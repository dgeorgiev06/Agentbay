import type { RealRun, Request } from "../lib/request.ts";
import type { ProofStep } from "../lib/step.ts";
import { broken, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";
import { runsInCopy, type BayRun } from "./bay-run.ts";

export type RealThingEvidence =
  | { readonly found: "not copied"; readonly reason: string }
  | { readonly found: "ran"; readonly runs: readonly BayRun[] };

function runParts(run: BayRun | undefined, expected: RealRun, place: string): readonly Part[] {
  if (run === undefined) {
    return [unknown(`${place} was not run.`)];
  }
  if (run.ran === "not known") {
    return [unknown(`${place} is not known. ${run.reason}`)];
  }
  const text = run.stdout === expected.stdout ? [] : [broken(`${place} printed other than the item expects.`)];
  const ended = String(run.exitCode);
  const code =
    run.exitCode === expected.exitCode
      ? []
      : [broken(`${place} ended with the exit code ${ended}, not ${String(expected.exitCode)}.`)];
  return [...text, ...code];
}

export function realThingParts(expected: readonly RealRun[], evidence: RealThingEvidence): Parts {
  if (evidence.found === "not copied") {
    return { parts: [unknown(evidence.reason)], whenPassed: "" };
  }
  const all = String(expected.length);
  const [first, ...rest] = expected.flatMap((each, index) =>
    runParts(evidence.runs[index], each, `Run ${String(index + 1)} of ${all}`),
  );
  return {
    parts: first === undefined ? [held] : [first, ...rest],
    whenPassed: `Every run printed the expected text and ended with the expected exit code: ${all} of ${all}.`,
  };
}

export async function realThingEvidence(
  step: ProofStep,
  request: Request,
  runs: readonly RealRun[],
): Promise<RealThingEvidence> {
  const ran = await runsInCopy(
    step,
    request.head,
    runs.map((run) => run.bay),
  );
  return ran.copied ? { found: "ran", runs: ran.runs } : { found: "not copied", reason: ran.reason };
}

export async function proveRealThing(
  step: ProofStep,
  request: Request,
  proof: { readonly runs: readonly RealRun[] },
): Promise<Parts> {
  return realThingParts(proof.runs, await realThingEvidence(step, request, proof.runs));
}
