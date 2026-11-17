import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { git, openRepositoryProject, refsAndWorktrees } from "./repository.ts";

test("cut makes the branch forge/<slice> and a worktree under .forge/worktrees/ at the base commit", async () => {
  const project = await openRepositoryProject();
  try {
    const output = await project.output("git-worktrees.cut", { slice: "first-slice", base: "main" });
    assert.deepEqual(output, {
      folder: ".forge/worktrees/first-slice",
      branch: "forge/first-slice",
      commit: project.base,
    });
    assert.equal(git(project, ".", ["rev-parse", "forge/first-slice"]).trim(), project.base);
    assert.equal(git(project, ".forge/worktrees/first-slice", ["rev-parse", "HEAD"]).trim(), project.base);
    assert.equal(git(project, ".forge/worktrees/first-slice", ["branch", "--show-current"]), "forge/first-slice\n");
    assert.equal(git(project, ".forge/worktrees/first-slice", ["status", "--porcelain"]), "");
  } finally {
    await project.close();
  }
});

test("a second cut of the same name is refused and changes nothing", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "again", base: project.base });
    const before = refsAndWorktrees(project);
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "again", base: project.base }),
      "The branch forge/again already exists, so the slice again is not cut again.",
    );
    assert.equal(refsAndWorktrees(project), before);
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

test("a cut from a commit that does not exist is refused", async () => {
  const project = await openRepositoryProject();
  try {
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "lost", base: "no-such-branch" }),
      "There is no commit no-such-branch in the repository.",
    );
  } finally {
    await project.close();
  }
});

test("a slice name with a slash, a space or a leading dash, or a base with a leading dash, is refused and no command runs", async () => {
  const project = await openRepositoryProject();
  try {
    const before = refsAndWorktrees(project);
    const slice =
      "input.slice is not in the expected form. Expected: The slice's name: letters, digits and dashes, " +
      "starting with a letter or digit. The branch is forge/ and the name.";
    for (const name of ["a/b", "a b", "-b"]) {
      assert.equal(await project.refusal("git-worktrees.cut", { slice: name, base: "main" }), slice);
    }
    assert.equal(
      await project.refusal("git-worktrees.cut", { slice: "fine", base: "--orphan" }),
      "input.base is not in the expected form. Expected: The commit the slice starts from. A commit: a full or " +
        "short hash, or a branch name. It has no .. and does not start with a dash.",
    );
    assert.equal(refsAndWorktrees(project), before);
    assert.deepEqual(await project.runs(), []);
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
