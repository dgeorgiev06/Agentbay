import { computed, joined, type CardLine } from "./card-lines.ts";
import { notHeldLine, tallyWords, type NotHeld } from "./practice-answers.ts";
import type { JudgedPractices, NotHeldPractice } from "./reviewer-practices.ts";
import { keptFromCard, type RoundsOnCard } from "./round-card.ts";

const notJudged = "practices: not judged, since the rounds ended with no review";

function judgedOf(rounds: RoundsOnCard | undefined): JudgedPractices | undefined {
  return rounds?.judged?.practices;
}

export function mustNotHeld(rounds: RoundsOnCard | undefined, must: readonly string[]): readonly string[] {
  const notHeld = judgedOf(rounds)?.notHeld ?? [];
  return notHeld.filter((practice) => must.includes(practice.id)).map((practice) => practice.id);
}

export function mustClause(ids: readonly string[]): readonly string[] {
  if (ids.length === 0) {
    return [];
  }
  return [
    `the reviewer answered ${joined(ids)} not held, and the project marks ${ids.length === 1 ? "it" : "them"} must`,
  ];
}

function notHeldShown(practice: NotHeldPractice, must: readonly string[]): NotHeld {
  const shown = {
    id: practice.id,
    sentence: practice.sentence ?? keptFromCard,
    says: practice.says,
    path: practice.path,
  };
  return must.includes(practice.id) ? { ...shown, level: "must" } : shown;
}

function practicesTallyWords(rounds: RoundsOnCard): string {
  const practices = judgedOf(rounds);
  if (rounds.judged === undefined || practices === undefined) {
    return notJudged;
  }
  const who = `the reviewer in round ${String(rounds.judged.round)}`;
  return `${tallyWords(who, practices.tally)}; a check holds ${String(practices.checks)} more`;
}

export function reviewedPracticeLines(rounds: RoundsOnCard | undefined, must: readonly string[]): readonly CardLine[] {
  if (rounds === undefined) {
    return [];
  }
  const { judged } = rounds;
  const tally = computed("draw", practicesTallyWords(rounds));
  if (judged?.practices === undefined) {
    return [tally];
  }
  return [tally, ...judged.practices.notHeld.map((practice) => notHeldLine(judged.step, notHeldShown(practice, must)))];
}
