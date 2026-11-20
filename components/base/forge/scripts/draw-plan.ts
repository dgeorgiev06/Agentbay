import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { planCard, type PlannerAnswer } from "./lib/plan-card.ts";
import { planChanges } from "./lib/plan-changes.ts";
import { planDocument } from "./lib/plan-file.ts";
import { planOf } from "./lib/plan-form.ts";
import { givenOf, sourcesGiven } from "./lib/plan-sources.ts";
import { workOut } from "./lib/plan-waves.ts";
import { practiceAnswersOf } from "./lib/practice-answers.ts";
import { readFeatures } from "./lib/reading.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const start = fields.start ?? null;
  const given = givenOf(start);
  const again = fieldsOf(fields.again ?? null);
  const first = fields.first ?? null;
  const final = again.plan ?? null;
  const plan = planOf(planDocument(final, { requirements: given.file, design: given.design }));
  const sources = sourcesGiven(given);
  const challenged = fieldsOf(fields.challenged ?? null);
  const challenge = fieldsOf(challenged.challenge ?? null);
  const answer: PlannerAnswer =
    again.answered === true ? { kind: "answered", changes: planChanges(first, final) } : { kind: "not asked" };
  return planCard({
    job: textOf(fieldsOf(start).job),
    into: textOf(fields.into),
    design: sources.design,
    conditions: sources.conditions,
    plan,
    workedOut: workOut(plan, await readFeatures(context), sources),
    practices: practiceAnswersOf(challenge.practices),
    findings: textsOf(challenge.findings),
    challenger: challenged.challenged === true ? "challenge-2" : "challenge-1",
    answer,
  });
});
