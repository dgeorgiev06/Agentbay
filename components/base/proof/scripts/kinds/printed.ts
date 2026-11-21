import type { Command, Request } from "../lib/request.ts";
import type { ProofStep } from "../lib/step.ts";
import { heldWith, unknown, type Parts, type Printed } from "../lib/verdicts.ts";
import { runsInCopy, type RunsInCopy } from "./command-run.ts";

function printedOf(runs: RunsInCopy & { readonly copied: true }): Parts["parts"] {
  const all = String(runs.runs.length);
  const printed: Printed[] = [];
  const reasons: string[] = [];
  runs.runs.forEach((run, index) => {
    if (run.ran === "ended") {
      printed.push({ exitCode: run.exitCode, stdout: run.stdout });
    } else {
      reasons.push(`Run ${String(index + 1)} of ${all} is not known. ${run.reason}`);
    }
  });
  const [first, ...rest] = reasons.map(unknown);
  return first === undefined ? [heldWith(printed)] : [first, ...rest];
}

export function printedParts(runs: RunsInCopy): Parts {
  if (!runs.copied) {
    return { parts: [unknown(runs.reason)], whenPassed: "" };
  }
  const all = String(runs.runs.length);
  return {
    parts: printedOf(runs),
    whenPassed: `Every run ended and what it printed was read whole: ${all} of ${all}.`,
  };
}

export async function provePrinted(
  step: ProofStep,
  request: Request,
  proof: { readonly runs: readonly Command[] },
): Promise<Parts> {
  return printedParts(await runsInCopy(step, request.head, proof.runs));
}
