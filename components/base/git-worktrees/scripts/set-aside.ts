import type { ScriptContext } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { madeWorktree } from "./lib/folders.ts";
import { branchExists, commitOf, gitFed, gitSucceeded, safeCommitOf, succeededOutput } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

async function unusedWipBranch(context: ScriptContext, branch: string): Promise<string> {
  const prefix = `forge/wip/${branch.slice("forge/".length)}`;
  let number = 1;
  while (await branchExists(context, `${prefix}/${String(number)}`)) {
    number += 1;
  }
  return `${prefix}/${String(number)}`;
}

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const branch = await madeWorktree(context, folder, "set aside the work of");
  const head = await safeCommitOf(context, folder, "HEAD");
  if (isClean(await changesIn(context, folder))) {
    return { how: "nothing-changed", folder };
  }
  const wip = await unusedWipBranch(context, branch);
  await gitSucceeded(context, ".", ["make-branch", wip, head]);
  await gitSucceeded(context, folder, ["switch-branch", wip]);
  await gitSucceeded(context, folder, ["stage-everything"]);
  const input = `Set aside the changed and untracked files of ${branch}.\n`;
  succeededOutput(await gitFed(context, folder, { call: ["commit-staged"], input }), "commit-staged");
  await gitSucceeded(context, folder, ["switch-branch", branch]);
  return { how: "set-aside", folder, branch: wip, commit: await commitOf(context, ".", wip) };
});
