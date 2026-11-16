import { defineScript } from "../../../../bay/sdk.ts";
import { restoreInto, throwawayChanged } from "./lib/copies.ts";
import { madeCopy } from "./lib/folders.ts";
import { commitOf, gitSucceeded, refuseRepositoryFilters } from "./lib/git.ts";
import { requestOf } from "./lib/request.ts";

export const run = defineScript(async (input, context) => {
  const request = requestOf(input);
  const folder = request.text("folder");
  const paths = request.texts("paths");
  await madeCopy(context, folder, "change");
  await refuseRepositoryFilters(context, ".");
  const commit = await commitOf(context, ".", request.text("commit"));
  const listed = await gitSucceeded(context, ".", [
    "ls-tree",
    "-z",
    "--name-only",
    "--end-of-options",
    commit,
    "--",
    ...paths,
  ]);
  const atCommit = listed.split("\0");
  const placed = paths.filter((path) => atCommit.includes(path));
  for (const path of paths) {
    await throwawayChanged(context.files.remove(`${folder}/${path}`));
  }
  if (placed.length > 0) {
    await restoreInto(context, { folder, commit, paths: placed });
  }
  return { folder, placed, removed: paths.filter((path) => !placed.includes(path)) };
});
