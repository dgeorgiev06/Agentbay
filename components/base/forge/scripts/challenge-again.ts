import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { onlyWhenNeeded, planChallengeFound } from "./lib/plan-sources.ts";
import { planChanges } from "./lib/plan-changes.ts";
import { foundOf } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const { start = null, plan = null, again = null, first = null } = fieldsOf(input);
  const answer = fieldsOf(again);
  const found = planChallengeFound(first);
  const round = await onlyWhenNeeded(context, {
    needed: answer.answered === true,
    action: "challenge-plan",
    start,
    adds: {
      plan: answer.plan ?? null,
      answered: { ...foundOf(found), changes: [...planChanges(plan, answer.plan ?? null)] },
    },
    kept: first,
  });
  return { challenged: round.ran, challenge: round.answer };
});
