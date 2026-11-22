import { computed, shortCommit, type Card, type CardLine, type ComputedBy } from "./card-lines.ts";
import { examplesClauses } from "./examples-card.ts";
import { gateClauses, gateRanLines } from "./gate-card.ts";
import { verdictLines } from "./item-lines.ts";
import type { Verdict } from "./proof-answer.ts";
import { sentenceOf } from "./merge-choices.ts";
import { aloneWords, waveAnswer, type Alone, type Checked, type Joined, type WaveChecks } from "./wave-answer.ts";
import type { SliceTried } from "./tried-block.ts";
import { sliceLines } from "./wave-slice-lines.ts";
import type { Settled } from "./wave-standing.ts";
import type { GateShown } from "./start-card.ts";

export type WaveCardInput = {
  readonly wave: number;
  readonly into: string;
  readonly slices: readonly Settled[];
  readonly joined: Joined;
  readonly checks: WaveChecks;
  readonly alone: readonly Alone[];
  readonly must: readonly string[];
  readonly tried?: readonly SliceTried[];
  readonly gate?: GateShown;
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

const untriedWords = "the design's examples: not tried, since no combined head was proved to try them on";

function untriedLines(input: WaveCardInput): readonly CardLine[] {
  const carried = input.slices.some((settled) => settled.carriesExamples === true);
  return (input.tried ?? []).length === 0 && carried ? [computed("draw", untriedWords)] : [];
}

function combinedVerdicts(checks: WaveChecks): readonly Verdict[] {
  return checks.kind === "asked" ? checks.proof.verdicts : [];
}

function scopedBy(input: WaveCardInput): readonly (readonly Verdict[])[] {
  const included = input.slices.filter((settled) => settled.reason === undefined);
  return [combinedVerdicts(input.checks), ...included.map((settled) => settled.proof.verdicts)];
}

function checksAndGateLines(input: WaveCardInput): readonly CardLine[] {
  if (input.checks.kind !== "asked") {
    return [];
  }
  const slices = input.slices.map((settled) => settled.name);
  const ran = { slices, verdicts: combinedVerdicts(input.checks), scopedBy: scopedBy(input) };
  return [...checkedLines(input.checks, "prove"), ...gateRanLines(input.gate, ran)];
}

function waveLines(input: WaveCardInput): readonly CardLine[] {
  const checks = checksAndGateLines(input);
  const joinedLines = joinedWords(input.joined).map((words) => computed("draw", words));
  return [...joinedLines, ...checks, ...untriedLines(input), ...aloneLines(input.alone)];
}

function examplesReason(tried: readonly SliceTried[]): readonly string[] {
  return tried.flatMap((block) => examplesClauses(block, block.slice));
}

function mergedOf(joinedHead: Joined): readonly string[] {
  return joinedHead.kind === "combined" ? joinedHead.merged : [];
}

function triedOf(tried: readonly SliceTried[], name: string): { readonly tried?: SliceTried } {
  const block = tried.find((each) => each.slice === name);
  return block === undefined ? {} : { tried: block };
}

export function waveDrawn(input: WaveCardInput): WaveDrawn {
  const tried = input.tried ?? [];
  const gate = input.checks.kind === "asked" ? gateClauses(input.gate, scopedBy(input)) : [];
  const answer = waveAnswer(input.slices, input.joined, {
    checks: input.checks,
    examples: examplesReason(tried),
    gate,
  });
  const at = { merged: mergedOf(input.joined), must: input.must };
  const lines = [
    computed("draw", answer.words),
    ...input.slices.flatMap((settled, item) => sliceLines(settled, { ...at, item, ...triedOf(tried, settled.name) })),
    ...waveLines(input),
  ];
  const withheld = answer.reason === undefined ? {} : { merge: sentenceOf(answer.reason) };
  return {
    card: { title: `Merge wave ${String(input.wave)} into ${input.into}?`, lines, withheld },
    merge: answer.offered,
  };
}
