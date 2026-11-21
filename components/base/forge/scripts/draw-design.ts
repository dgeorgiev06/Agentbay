import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { stayedOf, withStayedLines } from "./lib/branch-endings.ts";
import { challengeOf, type Challenge } from "./lib/challenge-answer.ts";
import { designCard, type SecondPass } from "./lib/design-card.ts";
import { answerChanges } from "./lib/design-compare.ts";
import { checkedExamples } from "./lib/design-examples.ts";
import { designerAnswersOf, designOf } from "./lib/design-form.ts";
import { problemsByCheck } from "./lib/design-rules.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { notHeldIds } from "./lib/practice-answers.ts";
import { conditionsOf, requirementsOf } from "./lib/requirements-form.ts";

function secondPass(first: Challenge, changes: readonly string[]): SecondPass {
  return { notHeld: notHeldIds(first.practices), findings: first.findings.length, changes };
}

function answeredOf(again: Json): boolean {
  return fieldsOf(again).answered === true;
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const file = textOf(fields.file);
  const requirements = requirementsOf(fields.requirements ?? null);
  const conditions = conditionsOf(requirements);
  const firstFields = fieldsOf(fields.first ?? null);
  const first = challengeOf(firstFields);
  const again = fields.again ?? null;
  const final = fieldsOf(again).design ?? null;
  const deciding = challengeOf(fieldsOf(fields.challenged ?? null).challenge ?? null);
  const design = designOf(final);
  const byCheck = problemsByCheck({ job: requirements.job, file, conditions, design });
  const examples = await checkedExamples(context, design);
  const drawn = designCard({
    file,
    requirements,
    path: firstFields.path === "full" ? "full" : "light",
    chosen: first.chosen,
    because: first.because,
    design,
    problems: [...byCheck.flat(), ...examples.problems],
    checks: byCheck.length,
    refusedSchemas: examples.refusedSchemas,
    practices: deciding.practices,
    findings: deciding.findings,
    said: designerAnswersOf(final),
    differences: textsOf(firstFields.differences),
    ...(answeredOf(again)
      ? { second: secondPass(first, answerChanges(firstFields.design ?? null, final, conditions)) }
      : {}),
  });
  return withStayedLines(drawn, stayedOf(firstFields.stayed));
});
