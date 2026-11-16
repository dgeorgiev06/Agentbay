import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/mode-harness.ts";

const folder = ".forge/copies/later";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function twoCommits(project: ModeProject): Promise<string> {
  const earlier = await commitFiles(project, {
    files: { "kept.txt": "earlier\n", "dir/a.txt": "a\n" },
    message: "The earlier commit",
  });
  await commitFiles(project, {
    files: { "kept.txt": "later\n", "dir/only-later.txt": "later\n", "new.txt": "new\n" },
    message: "The later commit",
  });
  await project.output("git-worktrees.copy", { commit: "main", name: "later" });
  return earlier;
}

test("a named path takes its content at the other commit, a folder whole", async () => {
  const project = await openRepositoryProject();
  try {
    const earlier = await twoCommits(project);
    assert.deepEqual(
      await project.output("git-worktrees.overlay", { folder, commit: earlier, paths: ["kept.txt", "dir"] }),
      { folder, placed: ["kept.txt", "dir"], removed: [] },
    );
    const copy = join(project.root, folder);
    assert.equal(await readFile(join(copy, "kept.txt"), "utf8"), "earlier\n");
    assert.equal(await readFile(join(copy, "dir/a.txt"), "utf8"), "a\n");
    assert.equal(await exists(join(copy, "dir/only-later.txt")), false);
    assert.equal(await readFile(join(copy, "new.txt"), "utf8"), "new\n");
    assert.equal(git(project, ".", ["status", "--porcelain"]), "");
  } finally {
    await project.close();
  }
});

test("a folder taken from the other commit loses a file the copy gained that no commit holds", async () => {
  const project = await openRepositoryProject();
  try {
    const earlier = await twoCommits(project);
    await writeFiles(project, folder, { "dir/stray.txt": "made in the copy\n" });
    await project.output("git-worktrees.overlay", { folder, commit: earlier, paths: ["dir"] });
    const copy = join(project.root, folder);
    assert.equal(await exists(join(copy, "dir/stray.txt")), false);
    assert.equal(await readFile(join(copy, "dir/a.txt"), "utf8"), "a\n");
  } finally {
    await project.close();
  }
});

test("a path absent at the commit is removed from the copy", async () => {
  const project = await openRepositoryProject();
  try {
    const earlier = await twoCommits(project);
    assert.deepEqual(await project.output("git-worktrees.overlay", { folder, commit: earlier, paths: ["new.txt"] }), {
      folder,
      placed: [],
      removed: ["new.txt"],
    });
    assert.equal(await exists(join(project.root, folder, "new.txt")), false);
    assert.equal(await readFile(join(project.root, folder, "kept.txt"), "utf8"), "later\n");
  } finally {
    await project.close();
  }
});

test("a path with .. is refused before anything runs", async () => {
  const project = await openRepositoryProject();
  try {
    await twoCommits(project);
    assert.equal(
      await project.refusal("git-worktrees.overlay", { folder, commit: "main", paths: ["dir/../../README.md"] }),
      "input.paths.0 is not in the expected form. Expected: A path relative to the copy, the same as relative to " +
        "the repository's root. It has no .. and does not start with a dash.",
    );
  } finally {
    await project.close();
  }
});

test("a worktree's folder is refused", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "busy", base: "main" });
    assert.equal(
      await project.failure("git-worktrees.overlay", {
        folder: ".forge/worktrees/busy",
        commit: "main",
        paths: ["README.md"],
      }),
      "The folder .forge/worktrees/busy is a worktree, not a copy, so the mode does not change it.",
    );
  } finally {
    await project.close();
  }
});
