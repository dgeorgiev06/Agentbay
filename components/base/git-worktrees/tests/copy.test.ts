import assert from "node:assert/strict";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

async function filesUnder(folder: string): Promise<readonly string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
    .sort();
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function withPackages(project: ModeProject): Promise<string> {
  const commit = await commitFiles(project, {
    files: { ".gitignore": ".agentbay/\n.forge/\ndeps/\n", "src/main.txt": "main\n" },
    message: "Ignore installed packages",
  });
  await writeFiles(project, ".", { "deps/package/index.txt": "installed\n", "loose.txt": "not committed\n" });
  return commit;
}

test("a copy holds exactly the files of the commit and no .git", async () => {
  const project = await openRepositoryProject();
  try {
    const commit = await withPackages(project);
    await writeFiles(project, ".", { "src/main.txt": "changed after the commit\n" });
    assert.deepEqual(await project.output("git-worktrees.copy", { commit, name: "plain" }), {
      folder: ".forge/copies/plain",
    });
    const copy = join(project.root, ".forge/copies/plain");
    assert.deepEqual(await filesUnder(copy), [".gitignore", "README.md", "agentbay.config.yaml", "src/main.txt"]);
    assert.equal(await readFile(join(copy, "src/main.txt"), "utf8"), "main\n");
  } finally {
    await project.close();
  }
});

test("a path to link is a link in the copy to the project's own path", async () => {
  const project = await openRepositoryProject();
  try {
    const commit = await withPackages(project);
    await project.output("git-worktrees.copy", { commit, name: "linked", links: ["deps"] });
    const copy = join(project.root, ".forge/copies/linked");
    assert.equal(await readlink(join(copy, "deps")), join(project.root, "deps"));
    assert.equal(await readFile(join(copy, "deps/package/index.txt"), "utf8"), "installed\n");
  } finally {
    await project.close();
  }
});

test("a path to link that git does not ignore is refused, and no copy is made", async () => {
  const project = await openRepositoryProject();
  try {
    const commit = await withPackages(project);
    assert.equal(
      await project.failure("git-worktrees.copy", { commit, name: "refused", links: ["deps", "loose.txt"] }),
      "The path loose.txt is not ignored by git in the project, so the copy does not link to it.",
    );
    assert.equal(await exists(join(project.root, ".forge/copies/refused")), false);
  } finally {
    await project.close();
  }
});

test("a name already in use is refused", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.copy", { commit: "main", name: "twice" });
    assert.equal(
      await project.failure("git-worktrees.copy", { commit: "main", name: "twice" }),
      "The name twice is already in use by the copy .forge/copies/twice.",
    );
  } finally {
    await project.close();
  }
});
