import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { committedInto } from "./lib/commit-files.ts";
import { designFiles, designPath } from "./lib/design-files.ts";
import { designOf } from "./lib/design-form.ts";
import { textOf } from "./lib/json-values.ts";
import { requirementsOf } from "./lib/requirements-form.ts";

const stoppedOnCard = "The owner chose stop on the design card, so nothing is committed.";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const into = textOf(fields.into);
  if (fields.choice !== "approve") {
    return fail(stoppedOnCard);
  }
  const { job, version } = requirementsOf(fields.requirements ?? null);
  const file = textOf(fields.file);
  const files = designFiles({ job, file, version, design: designOf(fields.design ?? null) });
  const message = `${job}: the design, approved on the design card`;
  const slice = `${job}-design`;
  const { commit, merged } = await committedInto(context, {
    slice,
    into,
    files: () => Promise.resolve(files),
    message,
  });
  return {
    commit,
    merged,
    into,
    design: designPath(job),
    interface: files.map((each) => each.path),
  };
});
