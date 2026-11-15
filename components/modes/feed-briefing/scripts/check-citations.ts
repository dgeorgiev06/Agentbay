import { defineScript, fail } from "../../../../bay/sdk.ts";
import { citationFeedback } from "./lib/citations.ts";

export const run = defineScript((input, context) => {
  if (context.skillInput === undefined) {
    return fail("check-citations runs only as a check of the digest skill, which gives it the skill's input.");
  }
  const problems = citationFeedback(context.skillInput, input);
  return Promise.resolve(problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") });
});
