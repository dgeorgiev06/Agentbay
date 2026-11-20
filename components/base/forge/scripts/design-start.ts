import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { textOf } from "./lib/json-values.ts";
import { pathCard } from "./lib/path-card.ts";
import { refusedReason, requirementsOf } from "./lib/requirements-form.ts";

export const run = defineScript((input) => {
  const checked = fieldsOf(input).checked ?? null;
  const answer = fieldsOf(checked);
  if (answer.answer !== "accepted") {
    return fail(refusedReason(checked));
  }
  const file = textOf(answer.file);
  const requirements = requirementsOf(answer.requirements ?? null);
  const card = pathCard(file, requirements);
  return Promise.resolve({ file, job: requirements.job, requirements: answer.requirements ?? null, card });
});
