import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { git, openRepositoryProject, refsAndWorktrees } from "./repository.ts";

test("cut puts a worktree at .forge/worktrees/<slice> on its branch, and copy puts a copy at .forge/copies/<name>", async () => {
  const project = await openRepositoryProject();
  try {
    assert.deepEqual(await project.output("git-worktrees.cut", { slice: "first-slice", base: "main" }), {
      folder: ".forge/worktrees/first-slice",
      branch: "forge/first-slice",
      commit: project.base,
    });
    assert.equal(git(project, ".forge/worktrees/first-slice", ["branch", "--show-current"]), "forge/first-slice\n");
    assert.deepEqual(await project.output("git-worktrees.copy", { commit: "main", name: "plain" }), {
      folder: ".forge/copies/plain",
    });
  } finally {
    await project.close();
  }
});

test("a cut whose folder already holds files is refused and makes no branch", async () => {
  const project = await openRepositoryProject();
  try {
    await mkdir(join(project.root, ".forge/worktrees/taken"), { recursive: true });
    await writeFile(join(project.root, ".forge/worktrees/taken/notes.txt"), "made by hand\n", "utf8");
    const before = refsAndWorktrees(project);
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "taken", base: project.base }),
      "The folder .forge/worktrees/taken already exists, so the slice taken is not cut.",
    );
    assert.equal(refsAndWorktrees(project), before);
  } finally {
    await project.close();
  }
});

test("the slice name wip is refused, since set-aside keeps forge/wip/ for its branches", async () => {
  const project = await openRepositoryProject();
  try {
    const before = refsAndWorktrees(project);
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "wip", base: "main" }),
      "The slice name wip is kept for the branches set-aside makes under forge/wip/, so no slice is cut with it.",
    );
    assert.equal(refsAndWorktrees(project), before);
  } finally {
    await project.close();
  }
});
