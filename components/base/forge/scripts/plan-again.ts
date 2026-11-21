import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { planChallengeFound } from "./lib/plan-sources.ts";
import { foundOf, onlyWhenNeeded, secondPassNeeded } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const { start = null, first = null, challenge = null } = fieldsOf(input);
  const found = planChallengeFound(challenge);
  const round = await onlyWhenNeeded(context, {
    needed: secondPassNeeded(found),
    action: "plan",
    start,
    adds: { answering: { plan: first, ...foundOf(found) } },
    kept: first,
  });
  return { answered: round.ran, plan: round.answer };
});
