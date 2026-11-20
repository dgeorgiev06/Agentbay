import { computed, shortCommit, type Card, type CardLine, type ComputedBy } from "./card-lines.ts";
import { verdictLines } from "./item-lines.ts";
import { sentenceOf } from "./merge-choices.ts";
import { aloneWords, waveAnswer, type Alone, type Checked, type Joined, type WaveChecks } from "./wave-answer.ts";
import { sliceLines } from "./wave-slice-lines.ts";
import type { Settled } from "./wave-standing.ts";

export type WaveCardInput = {
  readonly wave: number;
  readonly into: string;
  readonly slices: readonly Settled[];
  readonly joined: Joined;
  readonly checks: WaveChecks;
  readonly alone: readonly Alone[];
  readonly must: readonly string[];
};

export type WaveDrawn = {
  readonly card: Card & { readonly withheld: { readonly merge?: string } };
  readonly merge: boolean;
};

function joinedWords(joinedHead: Joined): readonly string[] {
  switch (joinedHead.kind) {
    case "combined":
      return [
        `the combined head: ${shortCommit(joinedHead.head)} on ${joinedHead.branch}, ` +
          `with ${joinedHead.merged.join(", ")} merged in plan order`,
      ];
    case "conflict":
      return [`the combined head stopped at ${joinedHead.slice}: ${joinedHead.reason}`];
    case "nothing to join":
      return ["no combined head: no slice passed its own proof"];
  }
}

function checkedLines(checked: Checked, provedBy: ComputedBy): readonly CardLine[] {
  const ids = checked.slice.done.map((item) => item.id);
  const verdicts = checked.proof.verdicts.filter((verdict) => ids.includes(verdict.item));
  return verdictLines(checked.slice, verdicts, { messages: "filtered", provedBy });
}

function aloneLines(alone: readonly Alone[]): readonly CardLine[] {
  const each = alone.flatMap((proved) => [
    computed("draw", `${proved.name} proved alone with the checks:`),
    ...checkedLines(proved, "draw"),
  ]);
  return [...each, ...aloneWords(alone).map((words) => computed("draw", words))];
}

function waveLines(input: WaveCardInput): readonly CardLine[] {
  const checks = input.checks.kind === "asked" ? checkedLines(input.checks, "prove") : [];
  return [...joinedWords(input.joined).map((words) => computed("draw", words)), ...checks, ...aloneLines(input.alone)];
}

function mergedOf(joinedHead: Joined): readonly string[] {
  return joinedHead.kind === "combined" ? joinedHead.merged : [];
}

export function waveDrawn(input: WaveCardInput): WaveDrawn {
  const answer = waveAnswer(input.slices, input.joined, input.checks);
  const at = { merged: mergedOf(input.joined), must: input.must };
  const lines = [
    computed("draw", answer.words),
    ...input.slices.flatMap((settled, item) => sliceLines(settled, { ...at, item })),
    ...waveLines(input),
  ];
  const withheld = answer.reason === undefined ? {} : { merge: sentenceOf(answer.reason) };
  return {
    card: { title: `Merge wave ${String(input.wave)} into ${input.into}?`, lines, withheld },
    merge: answer.offered,
  };
}
