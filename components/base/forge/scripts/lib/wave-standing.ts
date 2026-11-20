import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { stayedOf, type Stayed } from "./branch-endings.ts";
import { bugsOnCard, type BugsOnCard } from "./bug-card.ts";
import { builtOf, type Built } from "./builder-answer.ts";
import { interfaceChanges, pinsOf, type Pins } from "./interface-pins.ts";
import { numberOf, textOf } from "./json-values.ts";
import { mergeReason } from "./merge-choices.ts";
import { mustNotHeld } from "./practices-block.ts";
import { bugsOf } from "./planting.ts";
import { provedOf, type Proved } from "./proof-answer.ts";
import { roundsOnCard, type RoundsOnCard } from "./round-card.ts";
import { roundsStateOf, type RoundsState } from "./rounds.ts";
import { sliceOf, type Slice } from "./slice-form.ts";
import { onlyChecks, withoutChecks } from "./tool-checks.ts";
import type { Leak } from "./leaks.ts";

export type Settled = {
  readonly name: string;
  readonly title: string;
  readonly base: string;
  readonly head: string;
  readonly work: string;
  readonly builder: string;
  readonly own: Slice;
  readonly checks: Slice;
  readonly proof: Proved;
  readonly rounds: RoundsOnCard;
  readonly leaks: readonly Leak[];
  readonly built: Built;
  readonly pins: Pins;
  readonly bugs: BugsOnCard;
  readonly stayed: readonly Stayed[];
  readonly reason?: string;
};

export type SettledParts = {
  readonly own: Slice;
  readonly proof: Proved;
  readonly state: RoundsState;
  readonly pins: Pins;
  readonly must: readonly string[];
};

export function ownProofReason(parts: SettledParts): string | undefined {
  const { state } = parts;
  return mergeReason({
    slice: parts.own,
    verdicts: parts.proof.verdicts,
    built: state.built,
    leaked: state.leaks.length > 0,
    mustNotHeld: mustNotHeld(roundsOnCard(state), parts.must),
    interfaceChanges: interfaceChanges(parts.pins),
  });
}

function stateOf(value: Json | undefined): RoundsState | undefined {
  return roundsStateOf(value ?? null);
}

export function settledOf(value: Json): Settled {
  const fields = fieldsOf(value);
  const proof = provedOf(fields.proof);
  const state = stateOf(fields.rounds);
  const reason = fields.reason;
  return {
    name: textOf(fields.name),
    title: textOf(fields.title),
    base: textOf(fields.base),
    head: textOf(fields.head),
    work: textOf(fields.work),
    builder: textOf(fields.builder),
    own: sliceOf(withoutChecks(fields.slice ?? null)),
    checks: sliceOf(onlyChecks(fields.slice ?? null)),
    proof,
    rounds: state === undefined ? { count: 0, most: 0, ended: "last-round" } : roundsOnCard(state),
    leaks: state?.leaks ?? [],
    built: builtOf(fields.built),
    pins: { base: pinsOf(fields.pinned), head: state?.pinnedAtHead ?? [] },
    bugs: bugsOnCard(bugsOf(fields.bugs), proof.verdicts, numberOf(fields.planted)),
    stayed: stayedOf(fields.stayed),
    ...(typeof reason === "string" ? { reason } : {}),
  };
}

export function isIncluded(settled: Settled): boolean {
  return settled.reason === undefined;
}
