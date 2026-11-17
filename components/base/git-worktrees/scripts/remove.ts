import { fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { throwawayChanged } from "./lib/copies.ts";
import { folderExists, forgetFolder, goneSentence, madeFolder, type Made } from "./lib/folders.ts";
import { gitSucceeded, isMerged, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

type Worktree = {
  readonly folder: string;
  readonly branch: string;
  readonly into: string;
};

function keptReason(worktree: Worktree, found: { readonly dirty: boolean; readonly merged: boolean }): string {
  const { folder, branch, into } = worktree;
  if (found.dirty && !found.merged) {
    return (
      `The worktree ${folder} has changed or untracked files, and its branch ${branch} is not merged into ` +
      `${into}, so both are kept.`
    );
  }
  if (found.dirty) {
    return `The worktree ${folder} has changed or untracked files, so it and its branch ${branch} are kept.`;
  }
  return `The branch ${branch} is not merged into ${into}, so the worktree ${folder} and its branch are kept.`;
}

async function refuseUnlessRemovable(context: ScriptContext, worktree: Worktree): Promise<void> {
  const { folder, branch, into } = worktree;
  await safeCommitOf(context, folder, into);
  const dirty = !isClean(await changesIn(context, folder));
  const merged = await isMerged(context, branch, into);
  if (dirty || !merged) {
    fail(keptReason(worktree, { dirty, merged }));
  }
  if (!(await isMerged(context, branch, "HEAD"))) {
    fail(
      `The branch ${branch} is merged into ${into} but not into the branch the project has checked out, and git ` +
        `deletes a branch only then, so the worktree ${folder} and its branch are kept.`,
    );
  }
}

async function removeWorktree(context: ScriptContext, worktree: Worktree): Promise<void> {
  await refuseUnlessRemovable(context, worktree);
  await gitSucceeded(context, ".", ["worktree", "remove", "--end-of-options", worktree.folder]);
  await forgetFolder(context, worktree.folder);
  await gitSucceeded(context, ".", ["branch", "-d", "--end-of-options", worktree.branch]);
}

function forgottenReason(folder: string, made: Made): string {
  const forgotten = `${goneSentence(folder)}, so the mode forgets it.`;
  return made.kind === "worktree" ? `${forgotten} Its branch ${made.branch} is kept.` : forgotten;
}

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const made = await madeFolder(context, folder);
  if (made === undefined) {
    return fail(`The folder ${folder} was not made by this mode, so the mode does not remove it.`);
  }
  if (!(await folderExists(context, folder))) {
    await forgetFolder(context, folder);
    return { folder, kind: "forgotten", reason: forgottenReason(folder, made) };
  }
  if (made.kind === "copy") {
    await throwawayChanged(context.files.remove(folder));
    await forgetFolder(context, folder);
    return { folder, kind: "copy" };
  }
  const into =
    request.optionalText("into") ??
    fail(`Name the branch that ${made.branch} must be merged into, as into, to remove the worktree ${folder}.`);
  await removeWorktree(context, { folder, branch: made.branch, into });
  return { folder, kind: "worktree", branch: made.branch };
});
