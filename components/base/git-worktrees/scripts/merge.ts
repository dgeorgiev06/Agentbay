import { fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { folderExists, madeWorktree, targetFolder } from "./lib/folders.ts";
import { branchExists, commitOf, firstLine, git, gitSucceeded, isMerged, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

type Merging = {
  readonly branch: string;
  readonly into: string;
  readonly target: string;
};

type Merged = { readonly how: "merged"; readonly commit: string } | { readonly how: "undone"; readonly reason: string };

const merge = [
  "merge",
  "--no-ff",
  "--no-edit",
  "--no-stat",
  "--no-verify",
  "--no-gpg-sign",
  "--no-verify-signatures",
  "--no-autostash",
  "--no-rerere-autoupdate",
  "--end-of-options",
];

async function refuseUnmergeable(context: ScriptContext, folder: string, merging: Merging): Promise<void> {
  const { branch, into, target } = merging;
  await safeCommitOf(context, folder, "HEAD");
  if (!(await branchExists(context, into))) {
    fail(`There is no branch ${into}, so the mode has nothing to merge ${branch} into.`);
  }
  if (!isClean(await changesIn(context, folder))) {
    fail(
      `The worktree ${folder} has changed or untracked files, so its branch ${branch} is not merged. ` +
        "Commit them or set them aside first.",
    );
  }
  if (await folderExists(context, target)) {
    fail(
      `The folder ${target} is left from an earlier merge into ${into}, so the mode does not merge until it is removed.`,
    );
  }
}

async function checkOutTarget(context: ScriptContext, merging: Merging): Promise<void> {
  const { branch, into, target } = merging;
  const added = await git(context, ".", ["worktree", "add", "--end-of-options", target, into]);
  if (added.exitCode === 0) {
    return;
  }
  if (added.stderr.includes("already used by worktree") || added.stderr.includes("already checked out")) {
    fail(
      `The branch ${into} is checked out in the project or in another worktree, and the mode merges only into a ` +
        `branch it can check out in a worktree of its own, so ${branch} is not merged.`,
    );
  }
  fail(`git worktree failed: ${firstLine(added.stderr)}`);
}

async function undone(context: ScriptContext, merging: Merging, stderr: string): Promise<Merged> {
  const { branch, into, target } = merging;
  const { conflicted } = await changesIn(context, target);
  const inProgress = await git(context, target, ["rev-parse", "--verify", "--quiet", "--end-of-options", "MERGE_HEAD"]);
  if (inProgress.exitCode === 0) {
    await gitSucceeded(context, target, ["merge", "--abort"]);
  }
  if (conflicted.length === 0) {
    return { how: "undone", reason: `git merge failed: ${firstLine(stderr)}` };
  }
  return {
    how: "undone",
    reason:
      `The branch ${branch} conflicts with ${into} in ${conflicted.join(", ")}, so the merge was undone: ` +
      `${into} is as it was and ${branch} is kept.`,
  };
}

async function mergedInTarget(context: ScriptContext, merging: Merging): Promise<Merged> {
  const ended = await git(context, merging.target, [...merge, merging.branch]);
  if (ended.exitCode !== 0) {
    return undone(context, merging, ended.stderr);
  }
  return { how: "merged", commit: await commitOf(context, merging.target, "HEAD") };
}

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const into = request.text("into");
  const branch = await madeWorktree(context, folder, "merge");
  const merging = { branch, into, target: targetFolder(into) };
  await refuseUnmergeable(context, folder, merging);
  if (await isMerged(context, branch, into)) {
    return { how: "already-merged", branch, into, commit: await commitOf(context, ".", into) };
  }
  await checkOutTarget(context, merging);
  const merged = await mergedInTarget(context, merging);
  await gitSucceeded(context, ".", ["worktree", "remove", "--end-of-options", merging.target]);
  if (merged.how === "undone") {
    return fail(merged.reason);
  }
  return { how: "merged", branch, into, commit: merged.commit };
});
