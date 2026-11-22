import type { Command, Request } from "../lib/request.ts";
import type { ProofStep } from "../lib/step.ts";
import { heldWith, unknown, type Parts } from "../lib/verdicts.ts";
import { runsInCopy, type CommandRun, type RunsInCopy } from "./command-run.ts";

const mostPrinted = 20_000;

function placeOf(index: number, all: number): string {
  return `Run ${String(index + 1)} of ${String(all)}`;
}

function notKnownReasons(runs: readonly CommandRun[]): readonly string[] {
  return runs.flatMap((run, index) =>
    run.ran === "ended" ? [] : [`${placeOf(index, runs.length)} is not known. ${run.reason}`],
  );
}

function lastParts(runs: readonly CommandRun[]): Parts["parts"] {
  const last = runs.at(-1);
  if (last?.ran !== "ended") {
    return [unknown("No run was made.")];
  }
  if (Array.from(last.stdout).length > mostPrinted) {
    const said = `${placeOf(runs.length - 1, runs.length)} printed more than the ${String(mostPrinted)} characters`;
    return [unknown(`${said} proof hands back for the kind printed.`)];
  }
  return [heldWith({ exitCode: last.exitCode, stdout: last.stdout })];
}

export function printedParts(runs: RunsInCopy): Parts {
  if (!runs.copied) {
    return { parts: [unknown(runs.reason)], whenPassed: "" };
  }
  const all = String(runs.runs.length);
  const [first, ...rest] = notKnownReasons(runs.runs).map(unknown);
  const parts: Parts["parts"] = first === undefined ? lastParts(runs.runs) : [first, ...rest];
  return { parts, whenPassed: `Every run ended and the last printed what is handed back: ${all} of ${all}.` };
}

export async function provePrinted(
  step: ProofStep,
  request: Request,
  proof: { readonly runs: readonly Command[] },
): Promise<Parts> {
  return printedParts(await runsInCopy(step, request.head, proof.runs));
}
