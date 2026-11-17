import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/mode-harness.ts";

const folder = ".forge/worktrees/feature";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function sliceIgnoringLogs(project: ModeProject): Promise<string> {
  await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
  return commitFiles(project, {
    folder,
    files: { ".gitignore": ".agentbay/\n.forge/\n*.log\n" },
    message: "Ignore logs",
  });
}

function wipBranches(project: ModeProject): string {
  return git(project, ".", ["branch", "--list", "forge/wip/*", "--format=%(refname:short) %(objectname)"]);
}

test("a changed and an untracked file are committed on forge/wip/<slice>/1, and the worktree is clean at its old head", async () => {
  const project = await openRepositoryProject();
  try {
    const head = await sliceIgnoringLogs(project);
    await writeFiles(project, folder, {
      "README.md": "Changed in the slice.\n",
      "notes/new.txt": "new\n",
      "run.log": "ignored\n",
    });
    const output = await project.output("git-worktrees.set-aside", { folder });
    const commit = git(project, ".", ["rev-parse", "forge/wip/feature/1"]).trim();
    assert.deepEqual(output, { how: "set-aside", folder, branch: "forge/wip/feature/1", commit });
    assert.equal(
      git(project, ".", ["log", "-1", "--format=%P|%s|%an <%ae>", commit]),
      `${head}|Set aside the changed and untracked files of forge/feature.|` +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n",
    );
    assert.equal(
      git(project, ".", ["ls-tree", "-r", "--name-only", commit]),
      ".gitignore\nREADME.md\nagentbay.config.yaml\nnotes/new.txt\n",
    );
    assert.equal(git(project, ".", ["show", `${commit}:README.md`]), "Changed in the slice.\n");
    assert.equal(git(project, ".", ["show", `${commit}:notes/new.txt`]), "new\n");
    assert.equal(git(project, folder, ["branch", "--show-current"]), "forge/feature\n");
    assert.equal(git(project, folder, ["rev-parse", "HEAD"]).trim(), head);
    assert.equal(git(project, folder, ["status", "--porcelain", "--untracked-files=all"]), "");
    assert.equal(await readFile(join(project.root, folder, "README.md"), "utf8"), "A small repository.\n");
    assert.equal(await exists(join(project.root, folder, "notes/new.txt")), false);
    assert.equal(await readFile(join(project.root, folder, "run.log"), "utf8"), "ignored\n");
  } finally {
    await project.close();
  }
});

test("a second set-aside makes forge/wip/<slice>/2 and leaves the first as it was", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceIgnoringLogs(project);
    await writeFiles(project, folder, { "first.txt": "first\n" });
    await project.output("git-worktrees.set-aside", { folder });
    const first = git(project, ".", ["rev-parse", "forge/wip/feature/1"]).trim();
    await writeFiles(project, folder, { "second.txt": "second\n" });
    const output = await project.output("git-worktrees.set-aside", { folder });
    const second = git(project, ".", ["rev-parse", "forge/wip/feature/2"]).trim();
    assert.deepEqual(output, { how: "set-aside", folder, branch: "forge/wip/feature/2", commit: second });
    assert.equal(wipBranches(project), `forge/wip/feature/1 ${first}\nforge/wip/feature/2 ${second}\n`);
    assert.equal(git(project, ".", ["show", `${second}:second.txt`]), "second\n");
    assert.throws(() => git(project, ".", ["show", `${second}:first.txt`]));
  } finally {
    await project.close();
  }
});

test("a number already taken by a branch is skipped, and that branch is not overwritten", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceIgnoringLogs(project);
    git(project, ".", ["branch", "forge/wip/feature/1", "main"]);
    await writeFiles(project, folder, { "work.txt": "work\n" });
    const output = await project.output("git-worktrees.set-aside", { folder });
    const second = git(project, ".", ["rev-parse", "forge/wip/feature/2"]).trim();
    assert.deepEqual(output, { how: "set-aside", folder, branch: "forge/wip/feature/2", commit: second });
    assert.equal(wipBranches(project), `forge/wip/feature/1 ${project.base}\nforge/wip/feature/2 ${second}\n`);
  } finally {
    await project.close();
  }
});

test("with nothing changed, nothing is done and no branch is made", async () => {
  const project = await openRepositoryProject();
  try {
    const head = await sliceIgnoringLogs(project);
    await writeFiles(project, folder, { "run.log": "ignored\n" });
    assert.deepEqual(await project.output("git-worktrees.set-aside", { folder }), { how: "nothing-changed", folder });
    assert.equal(wipBranches(project), "");
    assert.equal(git(project, folder, ["rev-parse", "HEAD"]).trim(), head);
    assert.equal(await readFile(join(project.root, folder, "run.log"), "utf8"), "ignored\n");
  } finally {
    await project.close();
  }
});

test("a copy's folder is refused", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.copy", { commit: "main", name: "spare" });
    assert.equal(
      await project.failure("git-worktrees.set-aside", { folder: ".forge/copies/spare" }),
      "The folder .forge/copies/spare is a copy, not a worktree, so the mode does not set aside the work of it.",
    );
  } finally {
    await project.close();
  }
});
