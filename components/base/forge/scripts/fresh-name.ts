import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { textOf } from "./lib/json-values.ts";
import { givenName } from "./lib/names-given.ts";

export const run = defineScript(async (input, context) => {
  const given = await givenName(context, textOf(fieldsOf(input).wanted));
  return { name: given.name };
});
