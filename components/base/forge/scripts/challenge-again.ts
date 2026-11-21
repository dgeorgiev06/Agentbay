import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { planChallengeFound } from "./lib/plan-sources.ts";
import { foundOf, onlyWhenNeeded } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const { start = null, again = null, first = null } = fieldsOf(input);
  const answer = fieldsOf(again);
  const found = planChallengeFound(first);
  const round = await onlyWhenNeeded(context, {
    needed: answer.answered === true,
    action: "challenge-plan",
    start,
    adds: { plan: answer.plan ?? null, answered: foundOf(found) },
    kept: first,
  });
  return { challenged: round.ran, challenge: round.answer };
});
