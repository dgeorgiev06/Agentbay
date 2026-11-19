import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/cards.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { namedTests } from "./lib/handed-tests.ts";
import { keptTests } from "./lib/kept-tests.ts";
import { refusedBugs } from "./lib/planting.ts";
import { listOf, textOf } from "./lib/json-values.ts";

export const run = defineScript(async (input, context) => {
  const asked = context.skillInput ?? null;
  const slice = sliceOf(fieldsOf(asked).slice);
  const code = listOf(fieldsOf(asked).code).map((file) => textOf(fieldsOf(file).path));
  const tests = await keptTests(context, slice.name);
  return checkAnswer(refusedBugs(input, { code, fixed: namedTests(slice), tests }));
});
