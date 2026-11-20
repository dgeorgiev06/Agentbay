import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { provedAgainst } from "./lib/kept-proof.ts";
import { forgetKept, keptTests } from "./lib/kept-tests.ts";
import { sliceOf } from "./lib/slice-form.ts";

export const run = defineScript(async (input, context) => {
  const name = sliceOf(fieldsOf(input).slice).name;
  const proved = await provedAgainst(context, input, await keptTests(context, name));
  await forgetKept(context, name);
  return proved.ok ? proved.value : fail(proved.message);
});
