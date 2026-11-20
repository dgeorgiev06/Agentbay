import { defineScript } from "../../../../bay/sdk.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { planDocument } from "./lib/plan-file.ts";
import { planOf, twiceNamed } from "./lib/plan-form.ts";
import { givenOf, sourcesGiven } from "./lib/plan-sources.ts";
import { workOut } from "./lib/plan-waves.ts";

export const run = defineScript((input, context) => {
  const given = givenOf(context.skillInput ?? null);
  const plan = planOf(planDocument(input, { requirements: given.file, design: given.design }));
  const errors = workOut(plan, [], sourcesGiven(given)).problems.filter((problem) => problem.level === "error");
  const sentences = [...twiceNamed(plan), ...errors].map((problem) => problem.sentence);
  return checkAnswer(sentences);
});
