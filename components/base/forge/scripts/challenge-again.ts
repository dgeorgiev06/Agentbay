import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { plannerAsked } from "./lib/plan-sources.ts";
import { onlyWhenNeeded } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const { start = null, again = null, first = null } = fieldsOf(input);
  const answer = fieldsOf(again);
  const adds = { plan: answer.plan ?? null, answered: { findings: fieldsOf(first).findings ?? [] } };
  const round = await onlyWhenNeeded(context, {
    needed: answer.answered === true,
    action: "challenge-plan",
    asked: plannerAsked(start, adds),
    kept: first,
  });
  return { challenged: round.ran, challenge: round.answer };
});
