import { fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { blockedPaths, folderChangedSentences, movedSentence } from "./lib/checkout.ts";
import { folderExists, madeWorktree, targetFolder } from "./lib/folders.ts";
import {
  branchExists,
  commitOf,
  firstLine,
  git,
  gitFed,
  gitSucceeded,
  isMerged,
  safeCommitOf,
  succeededOutput,
} from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

type Merging = {
  readonly branch: string;
  readonly into: string;
  readonly target: string;
};

type Merged = { readonly how: "merged"; readonly commit: string } | { readonly how: "undone"; readonly reason: string };

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

async function checkedOutInProject(context: ScriptContext): Promise<string | undefined> {
  const ended = await git(context, ".", ["checked-out-branch", "HEAD"]);
  return ended.exitCode === 0 ? ended.stdout.trim() : undefined;
}

async function checkOutTarget(context: ScriptContext, merging: Merging): Promise<void> {
  const { branch, into, target } = merging;
  const added = await git(context, ".", ["add-worktree", target, into]);
  if (added.exitCode === 0) {
    return;
  }
  if (added.stderr.includes("already used by worktree") || added.stderr.includes("already checked out")) {
    fail(
      `The branch ${into} is checked out in another worktree than the project's own folder, so ${branch} is not ` +
        "merged into it. Switch that worktree to another branch, then merge again.",
    );
  }
  fail(`git worktree failed: ${firstLine(added.stderr)}`);
}

async function undone(context: ScriptContext, merging: Merging, stderr: string): Promise<Merged> {
  const { branch, into, target } = merging;
  const { conflicted } = await changesIn(context, target);
  const inProgress = await git(context, target, ["commit-of", "MERGE_HEAD"]);
  if (inProgress.exitCode === 0) {
    await gitSucceeded(context, target, ["abort-merge"]);
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

async function mergedOnBranch(context: ScriptContext, merging: Merging): Promise<Merged> {
  const ended = await git(context, merging.target, ["merge-branch", merging.branch]);
  if (ended.exitCode !== 0) {
    return undone(context, merging, ended.stderr);
  }
  return { how: "merged", commit: await commitOf(context, merging.target, "HEAD") };
}

async function mergedAtCommit(context: ScriptContext, merging: Merging): Promise<Merged> {
  const { branch, into, target } = merging;
  const begun = await git(context, target, ["merge-uncommitted", branch]);
  if (begun.exitCode !== 0) {
    return undone(context, merging, begun.stderr);
  }
  const message = `Merge branch '${branch}' into ${into}\n`;
  succeededOutput(await gitFed(context, target, { call: ["commit-staged"], input: message }), "commit-staged");
  return { how: "merged", commit: await commitOf(context, target, "HEAD") };
}

async function mergedBeside(context: ScriptContext, merging: Merging, start: string): Promise<Merged> {
  await gitSucceeded(context, ".", ["add-detached-worktree", merging.target, start]);
  const merged = await mergedAtCommit(context, merging);
  await gitSucceeded(context, ".", ["remove-worktree", merging.target]);
  return merged;
}

type Commits = { readonly start: string; readonly merge: string };

async function refuseUnlessLandable(context: ScriptContext, into: string, commits: Commits): Promise<void> {
  const moved = movedSentence({
    into,
    start: commits.start,
    checkedOut: await checkedOutInProject(context),
    head: await commitOf(context, ".", `refs/heads/${into}`),
  });
  const changed = (await changesIn(context, ".")).changed;
  const blocked = await blockedPaths(context, { from: commits.start, to: commits.merge });
  const sentences = [...moved, ...folderChangedSentences({ into, changed, blocked })];
  if (sentences.length > 0) {
    fail(sentences.join(" "));
  }
}

async function fastForwarded(context: ScriptContext, merging: Merging): Promise<string> {
  const start = await commitOf(context, ".", `refs/heads/${merging.into}`);
  const merged = await mergedBeside(context, merging, start);
  if (merged.how === "undone") {
    return fail(merged.reason);
  }
  await refuseUnlessLandable(context, merging.into, { start, merge: merged.commit });
  await gitSucceeded(context, ".", ["fast-forward", merged.commit]);
  return merged.commit;
}

async function mergedIntoBranch(context: ScriptContext, merging: Merging): Promise<string> {
  await checkOutTarget(context, merging);
  const merged = await mergedOnBranch(context, merging);
  await gitSucceeded(context, ".", ["remove-worktree", merging.target]);
  if (merged.how === "undone") {
    return fail(merged.reason);
  }
  return merged.commit;
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
  if ((await checkedOutInProject(context)) === `refs/heads/${into}`) {
    const commit = await fastForwarded(context, merging);
    return { how: "merged", branch, into, commit, landed: "checked-out-branch-fast-forwarded" };
  }
  const commit = await mergedIntoBranch(context, merging);
  return { how: "merged", branch, into, commit, landed: "branch-not-checked-out" };
});
