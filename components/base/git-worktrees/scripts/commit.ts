import { fail } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { madeWorktree } from "./lib/folders.ts";
import { commitOf, gitFed, gitSucceeded, safeCommitOf, succeededOutput } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const message = request.text("message");
  const branch = await madeWorktree(context, folder, "commit the work in");
  const head = await safeCommitOf(context, folder, "HEAD");
  if (head !== (await commitOf(context, ".", `refs/heads/${branch}`))) {
    fail(`The worktree ${folder} is not at the head of its branch ${branch}, so nothing is committed.`);
  }
  if (isClean(await changesIn(context, folder))) {
    return { how: "nothing-changed", folder, branch, commit: head };
  }
  await gitSucceeded(context, folder, ["switch-branch", branch]);
  await gitSucceeded(context, folder, ["stage-everything"]);
  succeededOutput(await gitFed(context, folder, { call: ["commit-staged"], input: `${message}\n` }), "commit-staged");
  return { how: "committed", folder, branch, commit: await commitOf(context, ".", `refs/heads/${branch}`) };
});
