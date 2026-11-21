import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { pathCard } from "./lib/path-card.ts";
import { acceptedOrStopped, requirementsOf } from "./lib/requirements-form.ts";

export const run = defineScript((input) => {
  const { file, requirements } = acceptedOrStopped(fieldsOf(input).checked ?? null, "design");
  const read = requirementsOf(requirements);
  const card = pathCard(file, read);
  return Promise.resolve({ job: read.job, requirements, card });
});
