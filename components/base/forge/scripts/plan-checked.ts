import { defineScript, type Json } from "../../../../bay/sdk.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { planDocument } from "./lib/plan-file.ts";
import { gatesClaimed, planOf, twiceNamed } from "./lib/plan-form.ts";
import { givenOf, sourcesGiven, type Given } from "./lib/plan-sources.ts";
import { workOut } from "./lib/plan-waves.ts";

export function refusedSentences(input: Json, given: Given): readonly string[] {
  const document = planDocument(input, { requirements: given.file, design: given.design });
  const plan = planOf(document);
  const errors = workOut(plan, [], sourcesGiven(given)).problems.filter((problem) => problem.level === "error");
  return [...twiceNamed(plan), ...gatesClaimed(document), ...errors].map((problem) => problem.sentence);
}

export const run = defineScript((input, context) => {
  return checkAnswer(refusedSentences(input, givenOf(context.skillInput ?? null)));
});
