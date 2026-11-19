import { fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { commitEverything, workIn, type Work } from "./lib/changes.ts";
import { commitOf, gitSucceeded } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

function headOfBranch(context: ScriptContext, branch: string): Promise<string> {
  return commitOf(context, ".", `refs/heads/${branch}`);
}

async function refuseUnlessAtBranchHead(context: ScriptContext, folder: string, work: Work): Promise<void> {
  if (work.head !== (await headOfBranch(context, work.branch))) {
    fail(`The worktree ${folder} is not at the head of its branch ${work.branch}, so nothing is committed.`);
  }
}

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const work = await workIn(context, folder, "commit the work in");
  await refuseUnlessAtBranchHead(context, folder, work);
  if (!work.changed) {
    return { how: "nothing-changed", folder, branch: work.branch, commit: work.head };
  }
  await gitSucceeded(context, folder, ["switch-branch", work.branch]);
  await commitEverything(context, folder, request.text("message"));
  return { how: "committed", folder, branch: work.branch, commit: await headOfBranch(context, work.branch) };
});
