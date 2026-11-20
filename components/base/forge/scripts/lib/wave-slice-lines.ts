import { computed, joined, type CardLine } from "./card-lines.ts";
import { interfaceWords } from "./interface-pins.ts";
import { verdictLines } from "./item-lines.ts";
import { practicesTallyWords } from "./practices-block.ts";
import type { RoundsOnCard } from "./round-card.ts";
import { bugWords, leakWords, roundsRanWords } from "./slice-words.ts";
import type { Settled } from "./wave-standing.ts";

function placeWords(settled: Settled, merged: readonly string[]): string {
  const where = `the work and the tests are on ${settled.work}`;
  if (settled.reason !== undefined) {
    return `${settled.name} is left out: ${settled.reason} Its branches stay; ${where}`;
  }
  if (merged.includes(settled.name)) {
    return `${settled.name} is in the combined head; ${where}`;
  }
  return `${settled.name} passed its own proof and is not in the combined head; ${where}`;
}

function notHeldWords(rounds: RoundsOnCard, must: readonly string[]): readonly string[] {
  const notHeld = rounds.judged?.practices?.notHeld ?? [];
  if (notHeld.length === 0) {
    return [];
  }
  const ids = notHeld.map((practice) => (must.includes(practice.id) ? `${practice.id} (must)` : practice.id));
  return [`the reviewer answered not held: ${joined(ids)}`];
}

export function sliceLines(settled: Settled, at: { merged: readonly string[]; must: readonly string[] }): CardLine[] {
  const { rounds } = settled;
  const opening = [`${settled.name}: ${settled.title}`, placeWords(settled, at.merged)];
  const after = [
    practicesTallyWords(rounds),
    ...notHeldWords(rounds, at.must),
    ...interfaceWords(settled.pins),
    ...bugWords(settled.bugs),
    ...settled.leaks.map(leakWords),
    roundsRanWords(rounds),
  ];
  return [
    ...opening.map((words) => computed("draw", words)),
    ...verdictLines(settled.own, settled.proof.verdicts, { messages: "filtered", provedBy: "draw" }),
    ...after.map((words) => computed("draw", words)),
  ];
}
