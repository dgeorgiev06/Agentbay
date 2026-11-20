import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { checkedExamples } from "./lib/design-examples.ts";
import { designOf } from "./lib/design-form.ts";
import { designProblems } from "./lib/design-rules.ts";
import { textOf } from "./lib/json-values.ts";
import { conditionsOf, requirementsOf } from "./lib/requirements-form.ts";

export const run = defineScript(async (input, context) => {
  const asked = fieldsOf(context.skillInput ?? null);
  const requirements = requirementsOf(asked.requirements ?? null);
  const design = designOf(input);
  const problems = designProblems({
    job: requirements.job,
    file: textOf(asked.file),
    conditions: conditionsOf(requirements),
    design,
  });
  const examples = await checkedExamples(context, design);
  return checkAnswer([...problems, ...examples.problems]);
});
