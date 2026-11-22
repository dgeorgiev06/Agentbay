import { computed, type CardLine } from "./card-lines.ts";
import { fastChecksLine, gateLine, scopeClause } from "./gate-words.ts";
import type { Verdict } from "./proof-answer.ts";
import type { GateShown } from "./start-card.ts";

export type GateRan = {
  readonly slices: readonly string[];
  readonly verdicts: readonly Verdict[];
};

function scopeOf(verdicts: readonly Verdict[]): "passed" | "not passed" {
  return verdicts.some((verdict) => verdict.item === "scope" && verdict.verdict === "passed") ? "passed" : "not passed";
}

export function gateClauses(shown: GateShown | undefined, verdicts: readonly Verdict[]): readonly string[] {
  return shown === undefined ? [] : scopeClause(shown.gate, scopeOf(verdicts));
}

export function gateRanLines(shown: GateShown | undefined, ran: GateRan): readonly CardLine[] {
  if (shown === undefined) {
    return [];
  }
  const said = [
    gateLine(shown.gate, ran.slices, "after"),
    ...fastChecksLine(shown.gate, shown.alsoRun),
    ...gateClauses(shown, ran.verdicts),
  ];
  return said.map((words) => computed("draw", words));
}
