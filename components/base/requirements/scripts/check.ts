import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { checkFile } from "./lib/check.ts";

export const run = defineScript(async (input, context) => {
  const file = fieldsOf(input).file;
  return checkFile(context, typeof file === "string" ? file : "");
});
