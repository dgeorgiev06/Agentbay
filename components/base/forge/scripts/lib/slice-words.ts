import type { BugsOnCard } from "./bug-card.ts";
import { counted, joined } from "./card-lines.ts";
import type { Leak } from "./leaks.ts";
import type { RoundsEnded, RoundsOnCard } from "./round-card.ts";

const endedSaid: Readonly<Record<RoundsEnded, string>> = {
  leak: "a leak ended them",
  stopped: "the builder stopped",
  "no-findings": "the reviewer had no findings",
  "last-round": "no more may run",
};

export function roundsRanWords(rounds: RoundsOnCard): string {
  return `rounds: ${String(rounds.count)} of at most ${String(rounds.most)}; ${endedSaid[rounds.ended]}`;
}

export function bugWords(bugs: BugsOnCard | undefined): readonly string[] {
  if (bugs === undefined) {
    return [];
  }
  const planted = bugs.planted === 0 ? [] : [`the planter wrote ${counted(bugs.planted, "bug")}`];
  return [...planted, ...bugs.survived.map((bug) => `bug survived: ${bug.name}, in ${joined(bug.files)}`)];
}

export function leakWords(leak: Leak): string {
  switch (leak.kind) {
    case "shared-text":
      return `leak: ${leak.path} shares ${counted(leak.lines, "line")} with the tests`;
    case "mark":
      return `leak: ${leak.path} holds the mark planted in the tests`;
    case "mark-in-answer":
      return "leak: the builder's answer holds the mark planted in the tests";
  }
}
