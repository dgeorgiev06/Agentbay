import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/cards.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { handedTestsOf, refusedTests } from "./lib/handed-tests.ts";

export const run = defineScript((input, context) => {
  const slice = sliceOf(fieldsOf(context.skillInput ?? null).slice);
  const refused = refusedTests(slice, handedTestsOf(input));
  return checkAnswer(refused);
});
