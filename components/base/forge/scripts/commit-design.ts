import { defineScript, fail, fieldsOf, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { designFiles, designPath, type Written } from "./lib/design-files.ts";
import { designOf } from "./lib/design-form.ts";
import { textOf } from "./lib/json-values.ts";
import { requirementsOf } from "./lib/requirements-form.ts";

const stoppedOnCard = "The owner chose stop on the design card, so nothing is committed.";

async function written(context: ScriptContext, folder: string, files: readonly Written[]): Promise<void> {
  for (const file of files) {
    const answer = await context.files.write(`${folder}/${file.path}`, file.text);
    if (!answer.ok) {
      fail(`forge could not write ${file.path} into ${folder}: ${answer.message}`);
    }
  }
}

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const folder = textOf(fields.folder);
  const into = textOf(fields.into);
  if (fields.choice !== "approve") {
    await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
    return fail(stoppedOnCard);
  }
  const requirements = requirementsOf(fields.requirements ?? null);
  const { job, version } = requirements;
  const file = textOf(fields.file);
  const files = designFiles({ job, file, version, design: designOf(fields.design ?? null) });
  await written(context, folder, files);
  const message = `${job}: the design, approved on the design card`;
  const commit = await answerOf(context, "worktrees.commit", { folder, message });
  const merge = await answerOf(context, "worktrees.merge", { folder, into });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return {
    commit: textOf(commit.commit),
    merged: textOf(merge.commit),
    into,
    design: designPath(job),
    interface: files.map((each) => each.path),
  };
});
