import { defineScript, fail, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";
import { stayedOf, type Stayed } from "./lib/branch-endings.ts";
import { pinsOf } from "./lib/interface-pins.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { provedOf } from "./lib/proof-answer.ts";
import { roundsStateOf, type RoundsState } from "./lib/rounds.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { withoutChecks } from "./lib/tool-checks.ts";
import { ownProofReason } from "./lib/wave-standing.ts";

function reasonOf(fields: JsonFields, state: RoundsState, must: readonly string[]): string | null {
  const slice = fieldsOf(fields.slice ?? null).proved ?? null;
  const reason = ownProofReason({
    own: sliceOf(withoutChecks(slice)),
    proof: provedOf(fields.proof),
    state,
    pins: { base: pinsOf(fields.pinned), head: state.pinnedAtHead ?? [] },
    must,
  });
  return reason ?? null;
}

function titleOf(fields: JsonFields): string {
  return textOf(fieldsOf(fieldsOf(fields.request ?? null).planned ?? null).title);
}

function stayedIn(state: RoundsState, bugs: JsonFields): readonly Stayed[] {
  return [...(state.stayed ?? []), ...stayedOf(bugs.stayed)];
}

function examplesOf(fields: JsonFields): Json {
  return fieldsOf(fields.request ?? null).examples ?? [];
}

export const run = defineScript((input, context) => {
  const fields = fieldsOf(input);
  const started = fieldsOf(fields.slice ?? null);
  const slice = started.proved ?? null;
  const state = roundsStateOf(fields.rounds) ?? fail("settle was given no state of the rounds.");
  const bugs = fieldsOf(fields.bugs ?? null);
  return Promise.resolve({
    name: sliceOf(slice).name,
    title: titleOf(fields),
    base: textOf(started.base),
    head: state.head,
    work: state.branch,
    builder: state.builder.branch,
    slice,
    proof: fields.proof ?? null,
    rounds: fields.rounds ?? null,
    pinned: fields.pinned ?? [],
    bugs: bugs.bugs ?? [],
    planted: bugs.planted ?? 0,
    stayed: [...stayedIn(state, bugs)],
    declared: state.declared,
    built: state.built,
    reason: reasonOf(fields, state, textsOf(context.settings.mustPractices)),
    examples: examplesOf(fields),
  });
});
