import assert from "node:assert/strict";
import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/mode-harness.ts";

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

test("a copy is removed, and is then no longer one this mode made", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.copy", { commit: "main", name: "spent" });
    assert.deepEqual(await project.output("git-worktrees.remove", { folder: ".forge/copies/spent" }), {
      folder: ".forge/copies/spent",
      kind: "copy",
    });
    assert.equal(await exists(join(project.root, ".forge/copies/spent")), false);
    assert.equal(
      await project.failure("git-worktrees.remove", { folder: ".forge/copies/spent" }),
      "The folder .forge/copies/spent was not made by this mode, so the mode does not remove it.",
    );
  } finally {
    await project.close();
  }
});

test("a clean worktree whose branch is merged is removed with its branch", async () => {
  const project = await openRepositoryProject();
  try {
    await cutWithCommit(project);
    git(project, ".", ["merge", "--quiet", "--ff-only", "forge/done"]);
    assert.deepEqual(await project.output("git-worktrees.remove", { folder, into: "main" }), {
      folder,
      kind: "worktree",
      branch: "forge/done",
    });
    assert.deepEqual(await kept(project), [false, ""]);
    assert.doesNotMatch(git(project, ".", ["worktree", "list"]), /done/);
  } finally {
    await project.close();
  }
});

test("a worktree with a changed file is refused and kept with its branch", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "done", base: "main" });
    await writeFiles(project, folder, { "README.md": "Not yet committed.\n" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      "The worktree .forge/worktrees/done has changed or untracked files, so it and its branch forge/done are kept.",
    );
    assert.deepEqual(await kept(project), [true, "forge/done\n"]);
  } finally {
    await project.close();
  }
});

test("a worktree whose branch is not merged is refused and kept with its branch", async () => {
  const project = await openRepositoryProject();
  try {
    await cutWithCommit(project);
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      "The branch forge/done is not merged into main, so the worktree .forge/worktrees/done and its branch are kept.",
    );
    assert.deepEqual(await kept(project), [true, "forge/done\n"]);
  } finally {
    await project.close();
  }
});

test("a worktree that is both changed and not merged is refused with both reasons", async () => {
  const project = await openRepositoryProject();
  try {
    await cutWithCommit(project);
    await writeFiles(project, folder, { "more.txt": "more\n" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      "The worktree .forge/worktrees/done has changed or untracked files, and its branch forge/done is not " +
        "merged into main, so both are kept.",
    );
    assert.deepEqual(await kept(project), [true, "forge/done\n"]);
  } finally {
    await project.close();
  }
});

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

test("a worktree with no branch named to be merged into is refused", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "done", base: "main" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder }),
      "Name the branch that forge/done must be merged into, as into, to remove the worktree .forge/worktrees/done.",
    );
    assert.deepEqual(await kept(project), [true, "forge/done\n"]);
  } finally {
    await project.close();
  }
});

test("a folder outside .forge/ is refused and kept", async () => {
  const project = await openRepositoryProject();
  try {
    await mkdir(join(project.root, "src"), { recursive: true });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder: "src" }),
      "The folder src was not made by this mode, so the mode does not remove it.",
    );
    assert.equal(await exists(join(project.root, "src")), true);
  } finally {
    await project.close();
  }
});
