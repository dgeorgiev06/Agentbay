import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { git, openRepositoryProject } from "./repository.ts";
import type { ModeProject } from "../../../../tests/mode-harness.ts";

const worktree = ".forge/worktrees/lost";
const copy = ".forge/copies/lost";

async function cutAndLose(project: ModeProject): Promise<void> {
  await project.output("git-worktrees.cut", { slice: "lost", base: "main" });
  await rm(join(project.root, worktree), { recursive: true, force: true });
}

async function copyAndLose(project: ModeProject): Promise<void> {
  await project.output("git-worktrees.copy", { commit: "main", name: "lost" });
  await rm(join(project.root, copy), { recursive: true, force: true });
}

test("status says plainly that a worktree it made no longer exists", async () => {
  const project = await openRepositoryProject();
  try {
    await cutAndLose(project);
    assert.equal(
      await project.failure("git-worktrees.status", { folder: worktree, base: "main" }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not look at it.",
    );
  } finally {
    await project.close();
  }
});

test("overlay says plainly that a copy it made no longer exists", async () => {
  const project = await openRepositoryProject();
  try {
    await copyAndLose(project);
    assert.equal(
      await project.failure("git-worktrees.overlay", { folder: copy, commit: "main", paths: ["README.md"] }),
      "The folder .forge/copies/lost was made by this mode but no longer exists, so the mode does not change it.",
    );
  } finally {
    await project.close();
  }
});

test("remove forgets a worktree whose folder no longer exists, says so, and keeps its branch", async () => {
  const project = await openRepositoryProject();
  try {
    await cutAndLose(project);
    assert.deepEqual(await project.output("git-worktrees.remove", { folder: worktree, into: "main" }), {
      folder: worktree,
      kind: "forgotten",
      reason:
        "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode forgets it. " +
        "Its branch forge/lost is kept.",
    });
    assert.equal(git(project, ".", ["branch", "--list", "forge/*", "--format=%(refname:short)"]), "forge/lost\n");
    assert.equal(
      await project.failure("git-worktrees.remove", { folder: worktree, into: "main" }),
      "The folder .forge/worktrees/lost was not made by this mode, so the mode does not remove it.",
    );
  } finally {
    await project.close();
  }
});

test("remove forgets a copy whose folder no longer exists, and says so", async () => {
  const project = await openRepositoryProject();
  try {
    await copyAndLose(project);
    assert.deepEqual(await project.output("git-worktrees.remove", { folder: copy }), {
      folder: copy,
      kind: "forgotten",
      reason: "The folder .forge/copies/lost was made by this mode but no longer exists, so the mode forgets it.",
    });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder: copy }),
      "The folder .forge/copies/lost was not made by this mode, so the mode does not remove it.",
    );
  } finally {
    await project.close();
  }
});

test("merge says plainly that a worktree it made no longer exists", async () => {
  const project = await openRepositoryProject();
  try {
    await cutAndLose(project);
    git(project, ".", ["branch", "integration", "main"]);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder: worktree, into: "integration" }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not merge it.",
    );
  } finally {
    await project.close();
  }
});

test("set-aside says plainly that a worktree it made no longer exists", async () => {
  const project = await openRepositoryProject();
  try {
    await cutAndLose(project);
    assert.equal(
      await project.failure("git-worktrees.set-aside", { folder: worktree }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not set aside " +
        "the work of it.",
    );
  } finally {
    await project.close();
  }
});

test("apply says plainly that a copy it made no longer exists", async () => {
  const project = await openRepositoryProject();
  try {
    await copyAndLose(project);
    const patch = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-A\n+B\n";
    assert.equal(
      await project.failure("git-worktrees.apply", { folder: copy, patch }),
      "The folder .forge/copies/lost was made by this mode but no longer exists, so the mode does not apply a " +
        "patch to it.",
    );
  } finally {
    await project.close();
  }
});
