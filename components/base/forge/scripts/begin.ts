import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { textOf } from "./lib/json-values.ts";
import { stopReason } from "./lib/start-choices.ts";

export const run = defineScript((input) => {
  const choice = textOf(fieldsOf(input).choice);
  const stopped = stopReason(choice);
  return stopped === undefined ? Promise.resolve({ choice }) : fail(stopped);
});
