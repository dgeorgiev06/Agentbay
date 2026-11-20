import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { pinnedFiles } from "./lib/pinned-files.ts";
import { textOf, textsOf } from "./lib/json-values.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const pinned = await pinnedFiles(context, textOf(fields.folder), textsOf(fields.interface));
  return { pinned: [...pinned] };
});
