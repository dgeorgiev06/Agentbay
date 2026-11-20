import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { stayedOf, withStayedLines } from "./lib/branch-endings.ts";
import { challengeOf } from "./lib/challenge-answer.ts";
import { designCard } from "./lib/design-card.ts";
import { checkedExamples } from "./lib/design-examples.ts";
import { designOf } from "./lib/design-form.ts";
import { designProblems } from "./lib/design-rules.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { conditionsOf, requirementsOf } from "./lib/requirements-form.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const file = textOf(fields.file);
  const requirements = requirementsOf(fields.requirements ?? null);
  const challenged = fieldsOf(fields.challenged ?? null);
  const challenge = challengeOf(challenged);
  const design = designOf(challenged.design ?? null);
  const problems = designProblems({ job: requirements.job, file, conditions: conditionsOf(requirements), design });
  const examples = await checkedExamples(context, design);
  const drawn = designCard({
    file,
    requirements,
    path: challenged.path === "full" ? "full" : "light",
    chosen: challenge.chosen,
    because: challenge.because,
    design,
    problems: [...problems, ...examples.problems],
    refusedSchemas: examples.refusedSchemas,
    practices: challenge.practices,
    differences: textsOf(challenged.differences),
  });
  return withStayedLines(drawn, stayedOf(challenged.stayed));
});
