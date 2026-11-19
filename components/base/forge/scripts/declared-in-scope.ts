import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/cards.ts";
import { refusedDeclaration } from "./lib/declared.ts";

function textsOf(value: Json | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((text) => typeof text === "string") : [];
}

export const run = defineScript((input, context) => {
  const asked = fieldsOf(context.skillInput ?? null);
  const refused = refusedDeclaration({
    scope: sliceOf(asked.slice).scope,
    fixed: textsOf(asked.fixed),
    files: textsOf(fieldsOf(input).files),
  });
  if (refused.length === 0) {
    return Promise.resolve({ passed: true });
  }
  return Promise.resolve({ passed: false, feedback: refused.join(" ") });
});
