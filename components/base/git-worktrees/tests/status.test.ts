import assert from "node:assert/strict";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";

const folder = ".forge/worktrees/watched";

test("a worktree with no commits since the base and no changes is clean", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "watched", base: "main" });
    assert.deepEqual(await project.output("git-worktrees.status", { folder, base: "main" }), {
      head: project.base,
      commits: [],
      clean: true,
      changed: [],
      untracked: [],
    });
  } finally {
    await project.close();
  }
});

test("two commits since the base are given oldest first, with their subjects", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "watched", base: "main" });
    const first = await commitFiles(project, { folder, files: { "a.txt": "a\n" }, message: "Add the first file" });
    const second = await commitFiles(project, { folder, files: { "b.txt": "b\n" }, message: "Add the second file" });
    assert.deepEqual(await project.output("git-worktrees.status", { folder, base: project.base }), {
      head: second,
      commits: [
        { hash: first, subject: "Add the first file" },
        { hash: second, subject: "Add the second file" },
      ],
      clean: true,
      changed: [],
      untracked: [],
    });
  } finally {
    await project.close();
  }
});

test("a changed file and an untracked file are named, and the worktree is not clean", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "watched", base: "main" });
    await writeFiles(project, folder, { "README.md": "Changed by hand.\n", "notes/new.txt": "new\n" });
    assert.deepEqual(await project.output("git-worktrees.status", { folder, base: "main" }), {
      head: project.base,
      commits: [],
      clean: false,
      changed: ["README.md"],
      untracked: ["notes/new.txt"],
    });
  } finally {
    await project.close();
  }
});

test("a worktree this mode did not make is refused", async () => {
  const project = await openRepositoryProject();
  try {
    git(project, ".", ["worktree", "add", "--quiet", "--detach", ".forge/worktrees/by-hand", "main"]);
    assert.equal(
      await project.failure("git-worktrees.status", { folder: ".forge/worktrees/by-hand", base: "main" }),
      "The folder .forge/worktrees/by-hand was not made by this mode, so the mode does not look at it.",
    );
  } finally {
    await project.close();
  }
});
