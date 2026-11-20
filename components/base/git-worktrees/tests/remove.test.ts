import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

const folder = ".forge/worktrees/done";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function branches(project: ModeProject): string {
  return git(project, ".", ["branch", "--list", "forge/*", "--format=%(refname:short)"]);
}

async function kept(project: ModeProject): Promise<readonly unknown[]> {
  return [await exists(join(project.root, folder)), branches(project)];
}

async function cutWithCommit(project: ModeProject): Promise<void> {
  await project.output("git-worktrees.cut", { slice: "done", base: "main" });
  await commitFiles(project, { folder, files: { "work.txt": "work\n" }, message: "Do the work" });
}

test("a worktree merged into the named branch but not into the project's head is refused and kept", async () => {
  const project = await openRepositoryProject();
  try {
    await cutWithCommit(project);
    git(project, ".", ["branch", "release", "forge/done"]);
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "release" }),
      "The branch forge/done is merged into release but not into the branch the project has checked out, and git " +
        "deletes a branch only then, so the worktree .forge/worktrees/done and its branch are kept.",
    );
    assert.deepEqual(await kept(project), [true, "forge/done\n"]);
  } finally {
    await project.close();
  }
});

test("with the branch deleted, a worktree at a commit its branch does not hold is refused, so that commit is not lost", async () => {
  const project = await openRepositoryProject();
  try {
    await cutWithCommit(project);
    git(project, ".", ["merge", "--quiet", "--ff-only", "forge/done"]);
    git(project, folder, ["switch", "--quiet", "--detach"]);
    const loose = await commitFiles(project, { folder, files: { "loose.txt": "only here\n" }, message: "Loose" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      `The worktree ${folder} is at the commit ${loose}, which its branch forge/done does not hold, so the ` +
        "worktree and its branch are kept.",
    );
    assert.deepEqual(await kept(project), [true, "forge/done\n"]);
    assert.equal(git(project, folder, ["rev-parse", "HEAD"]).trim(), loose);
  } finally {
    await project.close();
  }
});
