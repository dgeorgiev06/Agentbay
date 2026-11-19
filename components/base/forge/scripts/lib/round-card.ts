import { counted, type RoundsEnded, type RoundsOnCard } from "./cards.ts";
import type { Condition } from "./review.ts";
import { lastRound, type Remaining, type RoundsState } from "./rounds.ts";

const findingsNamed = 3;

const addresseeSaid: Readonly<Record<Remaining["to"], string>> = {
  builder: "for the builder",
  "test-writer": "for the test writer",
};

function conditionSentence(condition: Condition): string {
  return condition.held
    ? `${condition.item} held by ${counted(condition.cases.length, "case")}`
    : `${condition.item} not held: ${condition.why}`;
}

function remainingSentences(remaining: readonly Remaining[]): readonly string[] {
  if (remaining.length === 0) {
    return ["no finding remains"];
  }
  const builder = remaining.filter((finding) => finding.to === "builder").length;
  const verb = remaining.length === 1 ? "remains" : "remain";
  const count =
    `${counted(remaining.length, "finding")} ${verb}: ${String(builder)} for the builder, ` +
    `${String(remaining.length - builder)} for the test writer`;
  const named = remaining
    .slice(0, findingsNamed)
    .map((finding) => `${addresseeSaid[finding.to]}, ${finding.question}: ${finding.case}`);
  return [count, ...named];
}

function endedOf(state: RoundsState): RoundsEnded {
  if (state.leaks.length > 0) {
    return "leak";
  }
  if (state.built.outcome === "stopped") {
    return "stopped";
  }
  return state.reviewedAt !== undefined && state.remaining.length === 0 ? "no-findings" : "last-round";
}

export function roundsOnCard(state: RoundsState): RoundsOnCard {
  const count = { count: state.round, most: lastRound, ended: endedOf(state) };
  if (state.reviewedAt === undefined) {
    return count;
  }
  const sentences = [...state.conditions.map(conditionSentence), ...remainingSentences(state.remaining)];
  return { ...count, judged: { step: state.reviewedAt, sentences } };
}
