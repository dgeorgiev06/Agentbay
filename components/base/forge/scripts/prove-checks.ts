import { defineScript, fail, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
import { gateFrom, gateOf, gatedOf, type Gate } from "./lib/gate.ts";
import { gateDiffers } from "./lib/gate-words.ts";
import { gatedAsked } from "./lib/gated-checks.ts";
import { keptTests } from "./lib/kept-tests.ts";
import { provedOf } from "./lib/proof-answer.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { roomBeside, waveTrials, type Entry, type SliceToTry } from "./lib/tried-examples.ts";
import { blocksBySlice, provedTrying, settingOf, toTryOf, type Setting } from "./lib/tried-block.ts";
import { checksVerdict } from "./lib/wave-answer.ts";

function slicesToTry(trying: Json | undefined): readonly SliceToTry[] {
  return listOf(fieldsOf(trying ?? null).slices).map((each) => {
    const fields = fieldsOf(each);
    return { slice: textOf(fields.slice), inHead: fields.inHead === true, toTry: toTryOf(fields.examples) };
  });
}

function entriesOf(asked: Json, trying: Json | undefined, setting: Setting): readonly Entry[] {
  if (setting === "off" || trying === undefined) {
    return [];
  }
  const room = roomBeside(sliceOf(fieldsOf(asked).slice).done.length);
  return waveTrials(slicesToTry(trying), { built: textsOf(fieldsOf(trying).built), room });
}

type WorkedOut = {
  readonly gate: Gate;
  readonly differs?: string;
};

function gateWorkedOut(fields: JsonFields): WorkedOut {
  const handed = gateFrom(fields.gate);
  const gate = gateOf(gatedOf(fields.gatedBy));
  return JSON.stringify(handed) === JSON.stringify(gate) ? { gate } : { gate, differs: gateDiffers(handed, gate) };
}

function withDifferenceFailed(proof: Json, differs: string | undefined): Json {
  if (differs === undefined) {
    return proof;
  }
  const fields = fieldsOf(proof);
  const failed = (verdict: Json): Json => {
    const { item = null, kind = null } = fieldsOf(verdict);
    return { item, kind, verdict: "failed", detail: differs };
  };
  const verdicts = listOf(fields.verdicts).map((verdict) =>
    fieldsOf(verdict).kind === "checks" ? failed(verdict) : verdict,
  );
  return { ...fields, verdicts };
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(fieldsOf(input).proving ?? null);
  if (fields.kind !== "asked") {
    return { kind: "not asked", alone: [] };
  }
  const worked = gateWorkedOut(fields);
  const asked = await gatedAsked(context, fieldsOf(fields.asked ?? null), worked.gate);
  const setting = settingOf(context.settings.tryExamples);
  const entries = entriesOf(asked, fields.trying, setting);
  const kept = await Promise.all(textsOf(fields.keptOf).map((name) => keptTests(context, name)));
  const proved = await provedTrying(context, asked, { entries, tests: kept.flat() });
  if (!proved.ok) {
    return fail(proved.message);
  }
  const proof = withDifferenceFailed(proved.proof, worked.differs);
  const checked = { slice: sliceOf(fieldsOf(asked).slice), proof: provedOf(proof) };
  const alone = checksVerdict(checked) === "failed" ? listOf(fields.whenFailed) : [];
  const head = textOf(fieldsOf(asked).head);
  const tried = blocksBySlice(slicesToTry(fields.trying), { setting, head }, proved.results);
  return { kind: "asked", proof, alone: [...alone], tried };
});
