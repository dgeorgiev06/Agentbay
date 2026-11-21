import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { textsOf } from "./lib/json-values.ts";
import { plannerAsked } from "./lib/plan-sources.ts";
import { onlyWhenNeeded } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const { start = null, first = null, challenge = null } = fieldsOf(input);
  const findings = [...textsOf(fieldsOf(challenge).findings)];
  const round = await onlyWhenNeeded(context, {
    needed: findings.length > 0,
    action: "plan",
    asked: plannerAsked(start, { answering: { plan: first, findings } }),
    kept: first,
  });
  return { answered: round.ran, plan: round.answer };
});
