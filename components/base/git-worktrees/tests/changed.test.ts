import assert from "node:assert/strict";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject } from "./repository.ts";

const moved = "A file long enough that git sees it moved rather than replaced.\n".repeat(4);

test("each path that differs between two commits is given with how it changed", async () => {
  const project = await openRepositoryProject();
  try {
    const from = await commitFiles(project, {
      files: { "kept.txt": "first\n", "gone.txt": "soon gone\n", "old-name.txt": moved },
      message: "Add three files",
    });
    git(project, ".", ["rm", "--quiet", "gone.txt"]);
    git(project, ".", ["mv", "old-name.txt", "new-name.txt"]);
    const to = await commitFiles(project, {
      files: { "kept.txt": "second\n", "added.txt": "new\n" },
      message: "Change, remove, move and add",
    });
    assert.deepEqual(await project.output("git-worktrees.changed", { from, to }), {
      paths: [
        { path: "added.txt", how: "added" },
        { path: "gone.txt", how: "deleted" },
        { path: "kept.txt", how: "modified" },
        { path: "new-name.txt", how: "renamed", from: "old-name.txt" },
      ],
    });
  } finally {
    await project.close();
  }
});

test("the same commit twice gives no paths", async () => {
  const project = await openRepositoryProject();
  try {
    assert.deepEqual(await project.output("git-worktrees.changed", { from: "main", to: project.base }), {
      paths: [],
    });
  } finally {
    await project.close();
  }
});

test("a commit that does not exist is refused", async () => {
  const project = await openRepositoryProject();
  try {
    assert.equal(
      await project.failure("git-worktrees.changed", { from: "main", to: "nowhere" }),
      "There is no commit nowhere in the repository.",
    );
  } finally {
    await project.close();
  }
});
