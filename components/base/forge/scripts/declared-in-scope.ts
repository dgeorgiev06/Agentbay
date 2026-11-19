import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/cards.ts";
import { checkAnswer } from "./lib/check-answer.ts";
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
  return checkAnswer(refused);
});
