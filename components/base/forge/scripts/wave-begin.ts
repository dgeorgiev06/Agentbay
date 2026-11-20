import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { stopReason } from "./lib/start-choices.ts";

export const run = defineScript((input) => {
  const fields = fieldsOf(input);
  const choice = textOf(fields.choice);
  const stopped = stopReason(choice);
  return stopped === undefined ? Promise.resolve({ choice, slices: [...textsOf(fields.slices)] }) : fail(stopped);
});
