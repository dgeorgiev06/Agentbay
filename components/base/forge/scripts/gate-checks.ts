import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { gateOf } from "./lib/gate.ts";
import { gatedAsked } from "./lib/gated-checks.ts";
import { sliceOf } from "./lib/slice-form.ts";

export const run = defineScript(async (input, context) => {
  const asked = fieldsOf(input);
  const gated = await gatedAsked(context, asked, gateOf([sliceOf(asked.slice)]));
  return { slice: gated.slice ?? null };
});
