import { defineScript, fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { challengeOf, refusedChallenge, type Challenge } from "./lib/challenge-answer.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { designOf } from "./lib/design-form.ts";
import { designProblems } from "./lib/design-rules.ts";
import { listOf, textOf } from "./lib/json-values.ts";
import { conditionsOf, requirementsOf } from "./lib/requirements-form.ts";

async function mergedProblems(context: ScriptContext, asked: Json, challenge: Challenge): Promise<readonly string[]> {
  if (challenge.chosen !== "merged" || challenge.design === undefined) {
    return [];
  }
  const shape = await context.schemas.check("schemas/design.json", challenge.design);
  if (!shape.ok) {
    return [`forge could not check the merged design's form: ${shape.message}`];
  }
  if (!shape.value.passed) {
    return shape.value.problems.map((problem) => `at ${problem.path || "its top"}, ${problem.message}`);
  }
  const requirements = requirementsOf(fieldsOf(asked).requirements ?? null);
  return designProblems({
    job: requirements.job,
    file: textOf(fieldsOf(asked).file),
    conditions: conditionsOf(requirements),
    design: designOf(challenge.design),
  });
}

export const run = defineScript(async (input, context) => {
  const asked = context.skillInput ?? null;
  const challenge = challengeOf(input);
  const practices = listOf(fieldsOf(asked).practices).map((practice) => textOf(fieldsOf(practice).id));
  const designs = listOf(fieldsOf(asked).designs).length;
  const merged = await mergedProblems(context, asked, challenge);
  return checkAnswer(refusedChallenge(challenge, { designs, practices }, merged));
});
