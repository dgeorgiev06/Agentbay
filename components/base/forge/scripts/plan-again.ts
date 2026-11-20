import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { textsOf } from "./lib/json-values.ts";
import { plannerInput } from "./lib/plan-sources.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const first = fields.first ?? null;
  const findings = textsOf(fieldsOf(fields.challenge ?? null).findings);
  if (findings.length === 0) {
    return { answered: false, plan: first };
  }
  const asked = fieldsOf(plannerInput(fields.start ?? null));
  const plan = await answerOf(context, "plan", { ...asked, answering: { plan: first, findings: [...findings] } });
  return { answered: true, plan };
});
