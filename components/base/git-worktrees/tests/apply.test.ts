import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, openRepositoryProject } from "./repository.ts";
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

async function copyWithFiles(project: ModeProject): Promise<void> {
  await commitFiles(project, {
    files: { "kept.txt": "one\ntwo\n", "gone.txt": "gone\n", "other.txt": "other\n" },
    message: "Files to patch",
  });
  await project.output("git-worktrees.copy", { commit: "main", name: "patched" });
}

function commandsRan(run: Awaited<ReturnType<ModeProject["run"]>>): number {
  return run.events.filter((event) => event.kind === "command").length;
}

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
