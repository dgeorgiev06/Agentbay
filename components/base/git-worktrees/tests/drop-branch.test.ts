import assert from "node:assert/strict";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, refsAndWorktrees } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

const folder = ".forge/worktrees/planter";

const branch = "forge/planter";

type Repository = ModeProject & { readonly base: string };

async function withPlanter(work: (project: Repository, head: string) => Promise<void>): Promise<void> {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "planter", base: "main" });
    const head = await commitFiles(project, { folder, files: { "bug.txt": "planted\n" }, message: "Plant a bug" });
    await work(project, head);
  } finally {
    await project.close();
  }
}

function listedBranches(project: ModeProject): string {
  return git(project, ".", ["branch", "--list", "forge/*", "--format=%(refname:short)"]);
}

test("an unmerged branch whose worktree was removed is dropped, git no longer lists it, and its commit is still there", async () => {
  await withPlanter(async (project, head) => {
    await project.output("git-worktrees.remove", { folder, branchAfter: "kept" });
    assert.deepEqual(await project.output("git-worktrees.drop-branch", { branch, into: "main" }), {
      how: "dropped",
      branch,
      commit: head,
    });
    assert.equal(listedBranches(project), "");
    assert.equal(git(project, ".", ["show", `${head}:bug.txt`]), "planted\n");
    assert.deepEqual(await project.output("git-worktrees.drop-branch", { branch }), { how: "not-there", branch });
  });
});

test("a branch its live worktree still has is refused with what to do, and the worktree and branch are as they were", async () => {
  await withPlanter(async (project, head) => {
    const before = refsAndWorktrees(project);
    assert.deepEqual(await project.output("git-worktrees.drop-branch", { branch }), {
      how: "refused",
      branch,
      commit: head,
      reason:
        `The worktree ${folder} of this mode still has the branch ${branch}, so it is kept. Remove the worktree ` +
        "first, with branchAfter kept, then drop the branch again.",
    });
    assert.equal(refsAndWorktrees(project), before);
  });
});

test("the branch the project's own folder has checked out is refused, and the folder stays on it", async () => {
  await withPlanter(async (project, head) => {
    await project.output("git-worktrees.remove", { folder, branchAfter: "kept" });
    git(project, ".", ["switch", "--quiet", branch]);
    const before = refsAndWorktrees(project);
    assert.deepEqual(await project.output("git-worktrees.drop-branch", { branch, into: "main" }), {
      how: "refused",
      branch,
      commit: head,
      reason:
        `The project's own folder has the branch ${branch} checked out, so it is kept. Switch the folder to ` +
        "another branch, then drop it again.",
    });
    assert.equal(refsAndWorktrees(project), before);
    assert.equal(git(project, ".", ["symbolic-ref", "--short", "HEAD"]), `${branch}\n`);
  });
});

test("the branch named as into is refused, also named as a ref", async () => {
  await withPlanter(async (project, head) => {
    await project.output("git-worktrees.remove", { folder, branchAfter: "kept" });
    const before = refsAndWorktrees(project);
    for (const into of [branch, `refs/heads/${branch}`]) {
      assert.deepEqual(await project.output("git-worktrees.drop-branch", { branch, into }), {
        how: "refused",
        branch,
        commit: head,
        reason: `The branch ${branch} is the branch work is merged into, named as into, so it is kept.`,
      });
    }
    assert.equal(refsAndWorktrees(project), before);
  });
});

test("a branch under forge/ the mode never makes is refused, and one outside forge/ is refused before any run", async () => {
  await withPlanter(async (project) => {
    git(project, ".", ["branch", "forge/wip", "main"]);
    const before = refsAndWorktrees(project);
    assert.deepEqual(await project.output("git-worktrees.drop-branch", { branch: "forge/wip" }), {
      how: "refused",
      branch: "forge/wip",
      commit: project.base,
      reason: "The branch forge/wip is not one this mode makes, forge/<slice> or forge/wip/<slice>/<n>, so it is kept.",
    });
    const runs = await project.runs();
    assert.match(await project.refusal("git-worktrees.drop-branch", { branch: "main" }), /^input\.branch is not/);
    assert.deepEqual(await project.runs(), runs);
    assert.equal(refsAndWorktrees(project), before);
  });
});

test("a branch checked out in a worktree the mode did not make is left to git, which keeps it, and the refusal quotes git", async () => {
  await withPlanter(async (project, head) => {
    await project.output("git-worktrees.remove", { folder, branchAfter: "kept" });
    git(project, ".", ["worktree", "add", "--quiet", ".forge/worktrees/by-hand", branch]);
    const before = refsAndWorktrees(project);
    const reason = await project.failure("git-worktrees.drop-branch", { branch });
    assert.match(reason, /^git branch failed: error: cannot delete branch 'forge\/planter' /);
    assert.equal(refsAndWorktrees(project), before);
    assert.equal(git(project, ".", ["rev-parse", branch]).trim(), head);
  });
});
