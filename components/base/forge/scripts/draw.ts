import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { bugsOnCard } from "./lib/bug-card.ts";
import { builtOf } from "./lib/builder-answer.ts";
import { pinsOf } from "./lib/interface-pins.ts";
import { gateOf } from "./lib/gate.ts";
import { gateShownOf } from "./lib/start-card.ts";
import { textsOf } from "./lib/json-values.ts";
import { drawn, type MergeCardInput } from "./lib/merge-card.ts";
import { provedOf } from "./lib/proof-answer.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { bugsOf } from "./lib/planting.ts";
import { roundsOnCard } from "./lib/round-card.ts";
import { roundsStateOf, type RoundsState } from "./lib/rounds.ts";
import { stayedOf } from "./lib/branch-endings.ts";
import { triedBlockOf } from "./lib/tried-block.ts";
import { withGateSaid } from "./lib/tool-checks.ts";

function roundsParts(rounds: RoundsState | undefined, pinned: Json | undefined): Partial<MergeCardInput> {
  if (rounds === undefined) {
    return {};
  }
  return {
    rounds: roundsOnCard(rounds),
    leaks: rounds.leaks,
    builder: rounds.builder.branch,
    pins: { base: pinsOf(pinned), head: rounds.pinnedAtHead ?? [] },
  };
}

function triedPart(proof: Json | undefined): Partial<MergeCardInput> {
  const tried = triedBlockOf(fieldsOf(proof ?? null).tried);
  return tried === undefined ? {} : { tried };
}

export const run = defineScript((input, context) => {
  const fields = fieldsOf(input);
  const branch = (key: "work" | "into"): string => {
    const value = fields[key];
    return typeof value === "string" ? value : "";
  };
  const rounds = roundsStateOf(fields.rounds);
  const proof = provedOf(fields.proof);
  const planted = typeof fields.planted === "number" ? fields.planted : 0;
  const bugs = fields.bugs === undefined ? {} : { bugs: bugsOnCard(bugsOf(fields.bugs), proof.verdicts, planted) };
  const gate = gateOf([sliceOf(fields.slice)]);
  const slice = sliceOf(withGateSaid(fields.slice ?? null, gate));
  const merge = drawn({
    slice,
    proof,
    built: builtOf(fields.built),
    builtAt: rounds?.builtAt ?? "build",
    work: branch("work"),
    kept: fields.kept === "with-tests" ? "with-tests" : "set-aside",
    caseMessages: fields.caseMessages === "filtered" ? "filtered" : "unfiltered",
    into: branch("into"),
    ...roundsParts(rounds, fields.pinned),
    stayed: [...(rounds?.stayed ?? []), ...stayedOf(fields.stayed)],
    mustPractices: textsOf(context.settings.mustPractices),
    ...bugs,
    ...triedPart(fields.proof),
    gate: gateShownOf(gate, context.settings.modeGateTests),
  });
  return Promise.resolve(merge);
});
