import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { wentAhead } from "./lib/go-ahead.ts";
import { textsOf } from "./lib/json-values.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const went = await wentAhead(context, fields);
  return { ...went, slices: [...textsOf(fields.slices)] };
});
