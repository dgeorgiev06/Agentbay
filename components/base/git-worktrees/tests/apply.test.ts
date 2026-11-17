import assert from "node:assert/strict";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

const folder = ".forge/copies/patched";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}

async function copyWithFiles(project: ModeProject): Promise<void> {
  await commitFiles(project, {
    files: { "kept.txt": "one\ntwo\n", "gone.txt": "gone\n", "other.txt": "other\n" },
    message: "Files to patch",
  });
  await project.output("git-worktrees.copy", { commit: "main", name: "patched" });
}

const addChangeDelete = [
  "diff --git a/kept.txt b/kept.txt",
  "--- a/kept.txt",
  "+++ b/kept.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+three",
  "diff --git a/dir/new.txt b/dir/new.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/dir/new.txt",
  "@@ -0,0 +1 @@",
  "+new",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "",
].join("\n");

function commandsRan(run: Awaited<ReturnType<ModeProject["run"]>>): number {
  return run.events.filter((event) => event.kind === "command").length;
}

test("a patch that adds, changes and deletes a file changes exactly those, and the project is as it was", async () => {
  const project = await openRepositoryProject();
  try {
    await copyWithFiles(project);
    const status = git(project, ".", ["status", "--porcelain=v1", "--untracked-files=all"]);
    assert.deepEqual(await project.output("git-worktrees.apply", { folder, patch: addChangeDelete }), {
      folder,
      paths: ["kept.txt", "dir/new.txt", "gone.txt"],
    });
    const copy = join(project.root, folder);
    assert.deepEqual(await filesUnder(copy), [
      ".gitignore",
      "README.md",
      "agentbay.config.yaml",
      "dir/new.txt",
      "kept.txt",
      "other.txt",
    ]);
    assert.equal(await readFile(join(copy, "kept.txt"), "utf8"), "one\nthree\n");
    assert.equal(await readFile(join(copy, "dir/new.txt"), "utf8"), "new\n");
    assert.equal(await readFile(join(copy, "other.txt"), "utf8"), "other\n");
    assert.equal(git(project, ".", ["status", "--porcelain=v1", "--untracked-files=all"]), status);
    assert.equal(await readFile(join(project.root, "kept.txt"), "utf8"), "one\ntwo\n");
  } finally {
    await project.close();
  }
});

test("a removed line that starts with two dashes is read as content, not as a file's name", async () => {
  const project = await openRepositoryProject();
  try {
    await commitFiles(project, { files: { "notes.sql": "-- old\n" }, message: "A comment" });
    await project.output("git-worktrees.copy", { commit: "main", name: "patched" });
    const patch =
      "diff --git a/notes.sql b/notes.sql\n--- a/notes.sql\n+++ b/notes.sql\n@@ -1 +1 @@\n--- old\n+-- new\n";
    assert.deepEqual(await project.output("git-worktrees.apply", { folder, patch }), { folder, paths: ["notes.sql"] });
    assert.equal(await readFile(join(project.root, folder, "notes.sql"), "utf8"), "-- new\n");
  } finally {
    await project.close();
  }
});

test("a patch that does not apply whole changes nothing and is refused with git's reason", async () => {
  const project = await openRepositoryProject();
  try {
    await copyWithFiles(project);
    const half = [
      "diff --git a/kept.txt b/kept.txt",
      "--- a/kept.txt",
      "+++ b/kept.txt",
      "@@ -1,2 +1,2 @@",
      " one",
      "-two",
      "+three",
      "diff --git a/other.txt b/other.txt",
      "--- a/other.txt",
      "+++ b/other.txt",
      "@@ -1 +1 @@",
      "-not what the file holds",
      "+changed",
      "",
    ].join("\n");
    assert.equal(
      await project.failure("git-worktrees.apply", { folder, patch: half }),
      "The patch does not apply to the copy, so nothing was changed: error: patch failed: other.txt:1",
    );
    const copy = join(project.root, folder);
    assert.equal(await readFile(join(copy, "kept.txt"), "utf8"), "one\ntwo\n");
    assert.equal(await readFile(join(copy, "other.txt"), "utf8"), "other\n");
  } finally {
    await project.close();
  }
});

test("a patch naming ../x is refused before git runs", async () => {
  const project = await openRepositoryProject();
  try {
    await copyWithFiles(project);
    const upward = "diff --git a/../x b/../x\nnew file mode 100644\n--- /dev/null\n+++ b/../x\n@@ -0,0 +1 @@\n+x\n";
    const run = await project.run("git-worktrees.apply", { folder, patch: upward });
    assert.deepEqual(run.state, {
      status: "failed",
      reason: "The patch names the path ../x, which has .., so nothing is applied.",
    });
    assert.equal(commandsRan(run), 0);
    assert.equal(await exists(join(project.root, ".forge/copies/x")), false);
  } finally {
    await project.close();
  }
});

test("a patch naming an absolute path is refused before git runs", async () => {
  const project = await openRepositoryProject();
  try {
    await copyWithFiles(project);
    const absolute = "--- /dev/null\n+++ /tmp/x\n@@ -0,0 +1 @@\n+x\n";
    const run = await project.run("git-worktrees.apply", { folder, patch: absolute });
    assert.deepEqual(run.state, {
      status: "failed",
      reason: "The patch names the path /tmp/x, which is absolute, so nothing is applied.",
    });
    assert.equal(commandsRan(run), 0);
    assert.equal(await exists(join(project.root, folder, "tmp")), false);
  } finally {
    await project.close();
  }
});

test("a worktree's folder is refused", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "busy", base: "main" });
    assert.equal(
      await project.failure("git-worktrees.apply", { folder: ".forge/worktrees/busy", patch: addChangeDelete }),
      "The folder .forge/worktrees/busy is a worktree, not a copy, so the mode does not apply a patch to it.",
    );
  } finally {
    await project.close();
  }
});

test("a path whose attributes in the copy name a filter is refused, and nothing is applied", async () => {
  const project = await openRepositoryProject();
  try {
    await commitFiles(project, { files: { ".gitattributes": "*.bin filter=lfs\n" }, message: "Name a filter" });
    await project.output("git-worktrees.copy", { commit: "main", name: "patched" });
    const binary = "diff --git a/x.bin b/x.bin\nnew file mode 100644\n--- /dev/null\n+++ b/x.bin\n@@ -0,0 +1 @@\n+x\n";
    assert.equal(
      await project.failure("git-worktrees.apply", { folder, patch: binary }),
      "The path x.bin has the filter lfs in the copy's attributes, and git could run that filter's command, so " +
        "nothing is applied.",
    );
    assert.equal(await exists(join(project.root, folder, "x.bin")), false);
  } finally {
    await project.close();
  }
});

test("a patch that writes through a link the copy holds is refused, and the project's own folder is as it was", async () => {
  const project = await openRepositoryProject();
  try {
    await commitFiles(project, { files: { ".gitignore": ".agentbay/\n.forge/\ndeps/\n" }, message: "Ignore deps" });
    await writeFiles(project, ".", { "deps/package.txt": "installed\n" });
    await project.output("git-worktrees.copy", { commit: "main", name: "patched", links: ["deps"] });
    const through =
      "diff --git a/deps/evil.txt b/deps/evil.txt\nnew file mode 100644\n--- /dev/null\n" +
      "+++ b/deps/evil.txt\n@@ -0,0 +1 @@\n+evil\n";
    assert.equal(
      await project.failure("git-worktrees.apply", { folder, patch: through }),
      "The patch does not apply to the copy, so nothing was changed: error: affected file 'deps/evil.txt' is " +
        "beyond a symbolic link",
    );
    assert.deepEqual(await filesUnder(join(project.root, "deps")), ["package.txt"]);
  } finally {
    await project.close();
  }
});
