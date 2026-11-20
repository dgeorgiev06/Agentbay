import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { listOf, numberOf, textOf, textsOf } from "./lib/json-values.ts";
import { provedOf } from "./lib/proof-answer.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { joinedOf, type Alone, type WaveChecks } from "./lib/wave-answer.ts";
import { waveDrawn } from "./lib/wave-card.ts";
import { settledOf } from "./lib/wave-standing.ts";

function flat(batches: Json | undefined): readonly Json[] {
  return listOf(batches).flatMap(listOf);
}

function checksOf(asked: Json, proved: Json | undefined): WaveChecks {
  const answer = fieldsOf(proved ?? null);
  if (answer.kind !== "asked") {
    return { kind: "not asked" };
  }
  return { kind: "asked", slice: sliceOf(fieldsOf(asked).slice), proof: provedOf(answer.proof) };
}

function aloneOf(requests: readonly Json[], answers: readonly Json[]): readonly Alone[] {
  return answers.map((answer, at) => {
    const slice = sliceOf(fieldsOf(fieldsOf(requests[at] ?? null).asked ?? null).slice);
    return { name: slice.name, slice, proof: provedOf(fieldsOf(answer).proof) };
  });
}

export const run = defineScript((input, context) => {
  const fields = fieldsOf(input);
  const wave = fieldsOf(fields.wave ?? null);
  const combined = fieldsOf(fields.combined ?? null);
  const proving = fieldsOf(combined.proving ?? null);
  const drawn = waveDrawn({
    wave: numberOf(wave.wave),
    into: textOf(wave.into),
    slices: flat(fields.slices).map(settledOf),
    joined: joinedOf(combined.joined),
    checks: checksOf(proving.asked ?? null, fields.proved),
    alone: aloneOf(flat(proving.whenFailed), flat(fields.alone)),
    must: textsOf(context.settings.mustPractices),
  });
  return Promise.resolve(drawn);
});
