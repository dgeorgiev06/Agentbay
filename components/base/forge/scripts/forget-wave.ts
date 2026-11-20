import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { textsOf } from "./lib/json-values.ts";
import { forgetKept } from "./lib/kept-tests.ts";

export const run = defineScript(async (input, context) => {
  const slices = textsOf(fieldsOf(input).slices);
  for (const slice of slices) {
    await forgetKept(context, slice);
  }
  return { forgotten: [...slices] };
});
