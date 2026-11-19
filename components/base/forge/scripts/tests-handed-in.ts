import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/cards.ts";
import { handedTestsOf, refusedTests } from "./lib/handed-tests.ts";

export const run = defineScript((input, context) => {
  const slice = sliceOf(fieldsOf(context.skillInput ?? null).slice);
  const refused = refusedTests(slice, handedTestsOf(input));
  if (refused.length === 0) {
    return Promise.resolve({ passed: true });
  }
  return Promise.resolve({ passed: false, feedback: refused.join(" ") });
});
