import { restoreInto, throwawayChanged } from "./lib/copies.ts";
import { madeCopy } from "./lib/folders.ts";
import { gitSucceeded, nulFields, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const paths = request.texts("paths");
  await madeCopy(context, folder, "change");
  const commit = await safeCommitOf(context, ".", request.text("commit"));
  const listed = await gitSucceeded(context, ".", ["paths-at-commit", commit, "--", ...paths]);
  const atCommit = nulFields(listed);
  const placed = paths.filter((path) => atCommit.includes(path));
  for (const path of paths) {
    await throwawayChanged(context.files.remove(`${folder}/${path}`));
  }
  if (placed.length > 0) {
    await restoreInto(context, { folder, commit, paths: placed });
  }
  return { folder, placed, removed: paths.filter((path) => !placed.includes(path)) };
});
