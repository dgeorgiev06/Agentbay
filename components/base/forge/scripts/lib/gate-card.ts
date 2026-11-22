import { computed, type CardLine } from "./card-lines.ts";
import { fastChecksLine, gateLine, scopeClause, type GateRan } from "./gate-words.ts";
import type { Verdict } from "./proof-answer.ts";
import type { GateShown } from "./start-card.ts";

export type GateProved = {
  readonly slices: readonly string[];
  readonly verdicts: readonly Verdict[];
  readonly scopedBy: readonly (readonly Verdict[])[];
};

const chosenRun = "chosen from testsFrom";

const everyTestRun = "and so did the test run:";

const noOwnTest = "in testsFrom is a test file";

function saidBy(verdict: Verdict): string {
  return verdict.verdict === "inconclusive" ? verdict.reason : verdict.detail;
}

export function gateRanOf(verdicts: readonly Verdict[]): GateRan {
  const said = verdicts.filter((verdict) => verdict.kind === "checks").map(saidBy);
  if (said.some((words) => words.includes(noOwnTest))) {
    return "no own test";
  }
  if (said.length > 0 && said.every((words) => words.includes(chosenRun))) {
    return "chosen";
  }
  return said.some((words) => words.includes(everyTestRun)) ? "every test" : "not said";
}

function scopePassed(verdicts: readonly Verdict[]): boolean {
  return verdicts.some((verdict) => verdict.item === "scope" && verdict.verdict === "passed");
}

export function gateClauses(
  shown: GateShown | undefined,
  scopedBy: readonly (readonly Verdict[])[],
): readonly string[] {
  if (shown === undefined) {
    return [];
  }
  return scopeClause(shown.gate, scopedBy.every(scopePassed) ? "passed" : "not passed");
}

export function gateRanLines(shown: GateShown | undefined, proved: GateProved): readonly CardLine[] {
  if (shown === undefined) {
    return [];
  }
  const said = [
    gateLine(shown.gate, proved.slices, gateRanOf(proved.verdicts)),
    ...fastChecksLine(shown.gate, shown.alsoRun),
    ...gateClauses(shown, proved.scopedBy),
  ];
  return said.map((words) => computed("draw", words));
}
