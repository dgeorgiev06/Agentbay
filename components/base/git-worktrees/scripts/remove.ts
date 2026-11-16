import { defineScript, fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { changesIn } from "./lib/changes.ts";
import { throwawayChanged } from "./lib/copies.ts";
import { forgetFolder, madeFolder } from "./lib/folders.ts";
import { commitOf, git, gitSucceeded, refuseRepositoryFilters } from "./lib/git.ts";
import { requestOf } from "./lib/request.ts";

type Worktree = {
  readonly folder: string;
  readonly branch: string;
  readonly into: string;
};

async function isMerged(context: ScriptContext, branch: string, into: string): Promise<boolean> {
  const ended = await git(context, ".", ["merge-base", "--is-ancestor", "--end-of-options", branch, into]);
  if (ended.exitCode !== 0 && ended.exitCode !== 1) {
    fail(`git merge-base failed: ${ended.stderr.trim()}`);
  }
  return ended.exitCode === 0;
}

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
  await commitOf(context, ".", into);
  await refuseRepositoryFilters(context, folder);
  const { changed, untracked } = await changesIn(context, folder);
  const dirty = changed.length > 0 || untracked.length > 0;
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

export const run = defineScript(async (input, context) => {
  const request = requestOf(input);
  const folder = request.text("folder");
  const made = await madeFolder(context, folder);
  if (made === undefined) {
    return fail(`The folder ${folder} was not made by this mode, so the mode does not remove it.`);
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
