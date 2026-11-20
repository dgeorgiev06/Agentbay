import { fail, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { throwawayChanged } from "./lib/copies.ts";
import { folderExists, forgetFolder, goneSentence, madeFolder, type Made } from "./lib/folders.ts";
import { commitOf, gitSucceeded, isMerged, refuseRepositoryFilters, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript, type Request } from "./lib/request.ts";

type Slice = {
  readonly folder: string;
  readonly branch: string;
};

type Worktree = Slice & {
  readonly into: string;
};

type BranchAfter = "deleted" | "kept";

function branchAfterOf(request: Request): BranchAfter {
  return request.optionalText("branchAfter") === "kept" ? "kept" : "deleted";
}

function changedSentence(slice: Slice): string {
  return `The worktree ${slice.folder} has changed or untracked files, so it and its branch ${slice.branch} are kept.`;
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
    return changedSentence(worktree);
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

async function refuseUnlessHeldByBranch(context: ScriptContext, slice: Slice, commit: string): Promise<void> {
  const head = await commitOf(context, slice.folder, "HEAD");
  if (!(await isMerged(context, head, commit))) {
    fail(
      `The worktree ${slice.folder} is at the commit ${head}, which its branch ${slice.branch} does not hold, so ` +
        "the worktree and its branch are kept.",
    );
  }
}

async function removeWithBranch(context: ScriptContext, worktree: Worktree): Promise<Json> {
  await refuseUnlessRemovable(context, worktree);
  await refuseUnlessHeldByBranch(context, worktree, await commitOf(context, ".", `refs/heads/${worktree.branch}`));
  await gitSucceeded(context, ".", ["remove-worktree", worktree.folder]);
  await forgetFolder(context, worktree.folder);
  await gitSucceeded(context, ".", ["delete-branch", worktree.branch]);
  return { folder: worktree.folder, kind: "worktree", branch: worktree.branch, branchAfter: "deleted" };
}

async function removeKeepingBranch(context: ScriptContext, slice: Slice): Promise<Json> {
  await refuseRepositoryFilters(context, slice.folder);
  const commit = await commitOf(context, ".", `refs/heads/${slice.branch}`);
  if (!isClean(await changesIn(context, slice.folder))) {
    fail(changedSentence(slice));
  }
  await refuseUnlessHeldByBranch(context, slice, commit);
  await gitSucceeded(context, ".", ["remove-worktree", slice.folder]);
  await forgetFolder(context, slice.folder);
  return { folder: slice.folder, kind: "worktree", branch: slice.branch, branchAfter: "kept", commit };
}

function removeWorktree(context: ScriptContext, request: Request, slice: Slice): Promise<Json> {
  const { folder, branch } = slice;
  const into = request.optionalText("into");
  if (branchAfterOf(request) === "deleted") {
    const named =
      into ?? fail(`Name the branch that ${branch} must be merged into, as into, to remove the worktree ${folder}.`);
    return removeWithBranch(context, { ...slice, into: named });
  }
  if (into !== undefined) {
    return fail(
      `With branchAfter kept, into is not given, so the worktree ${folder} and its branch ${branch} are kept.`,
    );
  }
  return removeKeepingBranch(context, slice);
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
  return removeWorktree(context, request, { folder, branch: made.branch });
});
