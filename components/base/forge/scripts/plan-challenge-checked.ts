import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { askedPractices, practiceAnswersOf, practiceProblems } from "./lib/practice-answers.ts";

export const run = defineScript((input, context) => {
  const asked = askedPractices(context.skillInput ?? null);
  const answers = practiceAnswersOf(fieldsOf(input).practices);
  return checkAnswer(practiceProblems({ heldBy: "a plan", asked, answers }));
});
