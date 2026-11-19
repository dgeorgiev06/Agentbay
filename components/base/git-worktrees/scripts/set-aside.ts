import type { ScriptContext } from "../../../../bay/sdk.ts";
import { commitEverything, workIn } from "./lib/changes.ts";
import { branchExists, commitOf, gitSucceeded } from "./lib/git.ts";
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
  const { branch, head, changed } = await workIn(context, folder, "set aside the work of");
  if (!changed) {
    return { how: "nothing-changed", folder };
  }
  const wip = await unusedWipBranch(context, branch);
  await gitSucceeded(context, ".", ["make-branch", wip, head]);
  await gitSucceeded(context, folder, ["switch-branch", wip]);
  await commitEverything(context, folder, `Set aside the changed and untracked files of ${branch}.`);
  await gitSucceeded(context, folder, ["switch-branch", branch]);
  return { how: "set-aside", folder, branch: wip, commit: await commitOf(context, ".", wip) };
});
