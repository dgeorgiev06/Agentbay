import type { ScriptContext } from "../../../../bay/sdk.ts";
import { dropVerdict, type BranchFacts } from "./lib/drop.ts";
import { liveWorktreeOf } from "./lib/folders.ts";
import { branchHead, checkedOutInProject, gitSucceeded } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

async function factsOf(context: ScriptContext, branch: string, into: string | undefined): Promise<BranchFacts> {
  return {
    branch,
    into,
    commit: await branchHead(context, branch),
    checkedOut: await checkedOutInProject(context),
    liveWorktree: await liveWorktreeOf(context, branch),
  };
}

export const run = defineRequestScript(async (request, context) => {
  const branch = request.text("branch");
  const verdict = dropVerdict(await factsOf(context, branch, request.optionalText("into")));
  if (verdict.how !== "drop") {
    return verdict;
  }
  await gitSucceeded(context, ".", ["force-delete-branch", branch]);
  return { how: "dropped", branch, commit: verdict.commit };
});
