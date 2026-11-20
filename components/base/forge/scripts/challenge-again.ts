import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { textsOf } from "./lib/json-values.ts";
import { plannerInput } from "./lib/plan-sources.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const first = fields.first ?? null;
  const again = fieldsOf(fields.again ?? null);
  if (again.answered !== true) {
    return { challenged: false, challenge: first };
  }
  const asked = fieldsOf(plannerInput(fields.start ?? null));
  const findings = [...textsOf(fieldsOf(first).findings)];
  const challenge = await answerOf(context, "challenge-plan", {
    ...asked,
    plan: again.plan ?? null,
    answered: { findings },
  });
  return { challenged: true, challenge };
});
