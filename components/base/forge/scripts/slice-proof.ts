import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { provedAgainst } from "./lib/kept-proof.ts";
import { keptTests } from "./lib/kept-tests.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { withoutChecks } from "./lib/tool-checks.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const slice = fields.slice ?? null;
  const tests = await keptTests(context, sliceOf(slice).name);
  const proved = await provedAgainst(context, { ...fields, slice: withoutChecks(slice) }, tests);
  return proved.ok ? proved.value : fail(proved.message);
});
