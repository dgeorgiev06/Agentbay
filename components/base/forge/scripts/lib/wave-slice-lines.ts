import { stayedLines } from "./branch-endings.ts";
import { computed, inItem, type CardLine } from "./card-lines.ts";
import { examplesLines } from "./examples-card.ts";
import { interfaceWords } from "./interface-pins.ts";
import { verdictLines } from "./item-lines.ts";
import { builderLines, roundLines, whereWords } from "./merge-card.ts";
import { reviewedPracticeLines } from "./practices-block.ts";
import { bugWords, leakWords } from "./slice-words.ts";
import type { TriedBlock } from "./tried-block.ts";
import type { Settled } from "./wave-standing.ts";

export type SliceAt = {
  readonly item: number;
  readonly merged: readonly string[];
  readonly must: readonly string[];
  readonly tried?: TriedBlock;
};

function placeWords(settled: Settled, merged: readonly string[]): string {
  const where = whereWords(settled.work, settled.builder);
  if (settled.reason !== undefined) {
    return `${settled.name} is left out: ${settled.reason} Its branches stay; ${where}`;
  }
  if (merged.includes(settled.name)) {
    return `${settled.name} is in the combined head; ${where}`;
  }
  return `${settled.name} passed its own proof and is not in the combined head; ${where}`;
}

export function sliceLines(settled: Settled, at: SliceAt): readonly CardLine[] {
  const { rounds } = settled;
  const opening = [`${settled.name}: ${settled.title}`, placeWords(settled, at.merged)];
  const after = [...interfaceWords(settled.pins), ...bugWords(settled.bugs), ...settled.leaks.map(leakWords)];
  return [
    ...opening.map((words) => computed("draw", words)),
    ...verdictLines(settled.own, settled.proof.verdicts, { messages: "filtered", provedBy: "draw" }),
    ...examplesLines(at.tried, "draw"),
    ...inItem(at.item, reviewedPracticeLines(rounds, at.must)),
    ...after.map((words) => computed("draw", words)),
    ...stayedLines(settled.stayed),
    ...inItem(at.item, [...roundLines(rounds), ...builderLines(settled.built, settled.builtAt)]),
  ];
}
