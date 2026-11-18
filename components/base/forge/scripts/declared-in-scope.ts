import { defineScript, fieldsOf, pathMatch } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/cards.ts";

export const run = defineScript((input, context) => {
  const scope = sliceOf(fieldsOf(context.skillInput ?? null).slice).scope;
  const declared = fieldsOf(input).files;
  const files = Array.isArray(declared) ? declared.filter((file) => typeof file === "string") : [];
  const outside = files.filter((file) => !scope.some((pattern) => pathMatch(pattern, file).kind === "matched"));
  if (outside.length === 0) {
    return Promise.resolve({ passed: true });
  }
  const feedback =
    `The declaration names ${outside.length === 1 ? "a file" : `${String(outside.length)} files`} ` +
    `outside the slice's write scope: ${outside.join(", ")}. ` +
    `Declare only files the scope admits: ${scope.join(", ")}.`;
  return Promise.resolve({ passed: false, feedback });
});
