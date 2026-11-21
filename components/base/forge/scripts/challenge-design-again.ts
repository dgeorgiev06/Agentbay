import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { challengeOf } from "./lib/challenge-answer.ts";
import { answerChanges } from "./lib/design-compare.ts";
import { textOf } from "./lib/json-values.ts";
import { conditionsOf, requirementsOf } from "./lib/requirements-form.ts";
import { askedWhenNeeded, foundOf } from "./lib/second-round.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const again = fieldsOf(fields.again ?? null);
  const first = fields.first ?? null;
  const conditions = conditionsOf(requirementsOf(fields.requirements ?? null));
  const changes = answerChanges(fieldsOf(first).design ?? null, again.design ?? null, conditions);
  const asked = {
    file: textOf(fields.file),
    requirements: fields.requirements ?? null,
    designs: [again.design ?? null],
    differences: [],
    practices: fieldsOf(fields.designs ?? null).practices ?? [],
    answered: { ...foundOf(challengeOf(first)), changes: [...changes] },
  };
  const round = await askedWhenNeeded(context, {
    needed: again.answered === true,
    action: "challenge",
    asked,
    kept: first,
  });
  return { challenged: round.ran, challenge: round.answer };
});
