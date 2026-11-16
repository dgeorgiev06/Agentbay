import { defineScript, fail } from "../../../../bay/sdk.ts";
import { recordFolder, sliceBranch, worktreeFolder } from "./lib/folders.ts";
import { branchExists, commitOf, git, gitSucceeded, refuseRepositoryFilters } from "./lib/git.ts";
import { requestOf } from "./lib/request.ts";

export const run = defineScript(async (input, context) => {
  const request = requestOf(input);
  const slice = request.text("slice");
  const branch = sliceBranch(slice);
  const folder = worktreeFolder(slice);
  await refuseRepositoryFilters(context, ".");
  const commit = await commitOf(context, ".", request.text("base"));
  if (await branchExists(context, branch)) {
    fail(`The branch ${branch} already exists, so the slice ${slice} is not cut again.`);
  }
  const added = await git(context, ".", ["worktree", "add", "--detach", "--end-of-options", folder, commit]);
  if (added.exitCode !== 0) {
    fail(
      added.stderr.includes("already exists")
        ? `The folder ${folder} already exists, so the slice ${slice} is not cut.`
        : `git worktree failed: ${added.stderr.trim()}`,
    );
  }
  await recordFolder(context, folder, { kind: "worktree", branch });
  await gitSucceeded(context, ".", ["branch", "--end-of-options", branch, commit]);
  await gitSucceeded(context, folder, ["switch", "--end-of-options", branch]);
  return { folder, branch, commit };
});
