import { counted, safeText } from "./card-lines.ts";
import type { Condition } from "./review.ts";
import { lastRound, type Remaining, type RoundsState } from "./rounds.ts";

type JudgedLines = {
  readonly step: string;
  readonly round: number;
  readonly sentences: readonly string[];
};

export type RoundsEnded = "leak" | "stopped" | "no-findings" | "last-round";

export type RoundsOnCard = {
  readonly count: number;
  readonly most: number;
  readonly ended: RoundsEnded;
  readonly judged?: JudgedLines;
};

const findingsNamed = 3;

const keptFix = "kept from the card: it quotes a test";

const reviewStep = /^review-(\d)$/;

function conditionSentence(condition: Condition): string {
  return condition.held
    ? `${condition.item} held by ${counted(condition.cases.length, "case")}`
    : `${condition.item} not held: ${condition.why}`;
}

function findingSentence(finding: Remaining): string {
  const fix = finding.fix === undefined ? keptFix : safeText(finding.fix);
  return finding.to === "builder"
    ? `for the builder, ${finding.question}: ${fix}`
    : `for the test writer, ${finding.question}, ${safeText(finding.case)}: ${fix}`;
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
  return [count, ...remaining.slice(0, findingsNamed).map(findingSentence)];
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
  const round = Number(reviewStep.exec(state.reviewedAt)?.[1] ?? state.round);
  return { ...count, judged: { step: state.reviewedAt, round, sentences } };
}
