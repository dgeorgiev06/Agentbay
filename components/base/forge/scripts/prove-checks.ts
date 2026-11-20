import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { listOf, textsOf } from "./lib/json-values.ts";
import { provedAgainst } from "./lib/kept-proof.ts";
import { keptTests } from "./lib/kept-tests.ts";
import { provedOf } from "./lib/proof-answer.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { checksVerdict } from "./lib/wave-answer.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(fieldsOf(input).proving ?? null);
  if (fields.kind !== "asked") {
    return { kind: "not asked", alone: [] };
  }
  const asked = fields.asked ?? null;
  const kept = await Promise.all(textsOf(fields.keptOf).map((name) => keptTests(context, name)));
  const proved = await provedAgainst(context, asked, kept.flat());
  if (!proved.ok) {
    return fail(proved.message);
  }
  const checked = { slice: sliceOf(fieldsOf(asked).slice), proof: provedOf(proved.value) };
  const alone = checksVerdict(checked) === "failed" ? listOf(fields.whenFailed) : [];
  return { kind: "asked", proof: proved.value, alone: [...alone] };
});
