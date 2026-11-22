import { defineScript, fail, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { listOf, textOf, textsOf } from "./lib/json-values.ts";
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

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(fieldsOf(input).proving ?? null);
  if (fields.kind !== "asked") {
    return { kind: "not asked", alone: [] };
  }
  const asked = fields.asked ?? null;
  const setting = settingOf(context.settings.tryExamples);
  const entries = entriesOf(asked, fields.trying, setting);
  const kept = await Promise.all(textsOf(fields.keptOf).map((name) => keptTests(context, name)));
  const proved = await provedTrying(context, asked, { entries, tests: kept.flat() });
  if (!proved.ok) {
    return fail(proved.message);
  }
  const checked = { slice: sliceOf(fieldsOf(asked).slice), proof: provedOf(proved.proof) };
  const alone = checksVerdict(checked) === "failed" ? listOf(fields.whenFailed) : [];
  const head = textOf(fieldsOf(asked).head);
  const tried = blocksBySlice(slicesToTry(fields.trying), { setting, head }, proved.results);
  return { kind: "asked", proof: proved.proof, alone: [...alone], tried };
});
