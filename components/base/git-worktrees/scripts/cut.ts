import { fail } from "../../../../bay/sdk.ts";
import { recordFolder, sliceBranch, worktreeFolder } from "./lib/folders.ts";
import { branchExists, git, gitSucceeded, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

export const run = defineRequestScript(async (request, context) => {
  const slice = request.text("slice");
  if (slice === "wip") {
    fail("The slice name wip is kept for the branches set-aside makes under forge/wip/, so no slice is cut with it.");
  }
  const branch = sliceBranch(slice);
  const folder = worktreeFolder(slice);
  const commit = await safeCommitOf(context, ".", request.text("base"));
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
