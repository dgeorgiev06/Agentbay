import assert from "node:assert/strict";
import { access, chmod, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import { commitFiles, git, openRepositoryProject, refsAndWorktrees } from "./repository.ts";

const folder = ".forge/copies/changed";

const notesAddedOld = [
  "diff --git a/notes.txt b/notes.txt",
  "--- a/notes.txt",
  "+++ b/notes.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+three",
  "diff --git a/docs/added.txt b/docs/added.txt",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/docs/added.txt",
  "@@ -0,0 +1 @@",
  "+added",
  "diff --git a/old.txt b/old.txt",
  "deleted file mode 100644",
  "--- a/old.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "",
].join("\n");

const notesThenWrong = [
  "diff --git a/notes.txt b/notes.txt",
  "--- a/notes.txt",
  "+++ b/notes.txt",
  "@@ -1,2 +1,2 @@",
  " one",
  "-two",
  "+three",
  "diff --git a/old.txt b/old.txt",
  "--- a/old.txt",
  "+++ b/old.txt",
  "@@ -1 +1 @@",
  "-not what the file holds",
  "+changed",
  "",
].join("\n");

function inCopy(project: ModeProject, gitArguments: readonly string[]): string {
  return git(project, folder, gitArguments).trim();
}

function listed(project: ModeProject): readonly string[] {
  return inCopy(project, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter((path) => path !== "");
}

function copyState(project: ModeProject): readonly string[] {
  return [
    inCopy(project, ["status", "--porcelain=v1", "--untracked-files=all"]),
    inCopy(project, ["log", "--format=%s"]),
  ];
}

async function copyOfFiles(project: ModeProject): Promise<string> {
  const commit = await commitFiles(project, {
    files: { "notes.txt": "one\ntwo\n", "old.txt": "gone\n", "docs/first.txt": "a\n" },
    message: "Files to change",
  });
  await project.output("git-worktrees.copy", { commit: "main", name: "changed" });
  return commit;
}

async function withCopy(
  work: (project: ModeProject & { readonly base: string }, commit: string) => Promise<void>,
): Promise<void> {
  const project = await openRepositoryProject();
  try {
    await work(project, await copyOfFiles(project));
  } finally {
    await project.close();
  }
}

test("overlay leaves the copy clean, with one commit more and exactly its files listed", async () => {
  await withCopy(async (project, commit) => {
    const paths = ["notes.txt", "docs", "missing.txt"];
    assert.deepEqual(await project.output("git-worktrees.overlay", { folder, commit: project.base, paths }), {
      folder,
      placed: [],
      removed: ["notes.txt", "docs", "missing.txt"],
    });
    assert.deepEqual(copyState(project), [
      "",
      `The paths notes.txt, docs, missing.txt as they are at ${project.base}.\nA throwaway copy of ${commit}.`,
    ]);
    assert.deepEqual(listed(project), [".gitignore", "README.md", "agentbay.config.yaml", "old.txt"]);
  });
});

test("apply leaves the copy clean, with one commit more listing a new file and not a deleted one", async () => {
  await withCopy(async (project, commit) => {
    await project.output("git-worktrees.apply", { folder, patch: notesAddedOld });
    assert.deepEqual(copyState(project), [
      "",
      `A patch to notes.txt, docs/added.txt, old.txt.\nA throwaway copy of ${commit}.`,
    ]);
    assert.deepEqual(listed(project), [
      ".gitignore",
      "README.md",
      "agentbay.config.yaml",
      "docs/added.txt",
      "docs/first.txt",
      "notes.txt",
    ]);
    assert.equal(inCopy(project, ["show", "HEAD:notes.txt"]), "one\nthree");
  });
});

test("half a patch is not kept: the copy's files, commits and status are as they were", async () => {
  await withCopy(async (project, commit) => {
    assert.match(
      await project.failure("git-worktrees.apply", { folder, patch: notesThenWrong }),
      /^The patch does not apply to the copy, so nothing was changed: /,
    );
    assert.deepEqual(copyState(project), ["", `A throwaway copy of ${commit}.`]);
    assert.equal(inCopy(project, ["show", "HEAD:notes.txt"]), "one\ntwo");
    assert.equal(git(project, folder, ["diff", "--stat"]), "");
  });
});

test("a copy whose .git now points at the project's repository, or is gone, is refused, and the project is as it was", async () => {
  await withCopy(async (project) => {
    const refused =
      "The copy .forge/copies/changed is no longer the top of a repository of its own, so the mode does not change it.";
    const before = [git(project, ".", ["status", "--porcelain=v1"]), refsAndWorktrees(project)];
    const gitFolder = join(project.root, folder, ".git");
    for (const tampering of ["points at the project", "is gone"]) {
      await rm(gitFolder, { recursive: true, force: true });
      if (tampering === "points at the project") {
        await writeFile(gitFolder, `gitdir: ${join(project.root, ".git")}\n`, "utf8");
      }
      assert.equal(await project.failure("git-worktrees.apply", { folder, patch: notesAddedOld }), refused, tampering);
      const overlay = { folder, commit: project.base, paths: ["notes.txt"] };
      assert.equal(await project.failure("git-worktrees.overlay", overlay), refused, tampering);
    }
    assert.deepEqual([git(project, ".", ["status", "--porcelain=v1"]), refsAndWorktrees(project)], before);
  });
});

test("a copy whose own configuration names a filter is refused by apply, and the filter does not run", async () => {
  await withCopy(async (project) => {
    const ran = join(project.root, "filter-ran");
    git(project, folder, ["config", "filter.evil.clean", `sh -c 'touch "${ran}"; cat'`]);
    assert.equal(
      await project.failure("git-worktrees.apply", { folder, patch: notesAddedOld }),
      "The repository's own configuration names filter.evil.clean. git could run the command of such a filter " +
        "or merge driver, so the mode does nothing in this repository until it is removed.",
    );
    assert.equal(inCopy(project, ["rev-list", "--count", "HEAD"]), "1");
  });
});

test("a copy whose own configuration demands signing gets apply's commit unsigned, and the signer does not run", async () => {
  await withCopy(async (project) => {
    const ran = join(project.root, "signer-ran");
    const signer = join(project.root, "signer.sh");
    await writeFile(signer, `#!/bin/sh\ntouch "${ran}"\n`, "utf8");
    await chmod(signer, 0o755);
    const settings: readonly (readonly [string, string])[] = [
      ["commit.gpgsign", "true"],
      ["gpg.format", "openpgp"],
      ["gpg.program", signer],
      ["user.signingkey", "someone"],
    ];
    for (const [key, value] of settings) {
      git(project, folder, ["config", key, value]);
    }
    await project.output("git-worktrees.apply", { folder, patch: notesAddedOld });
    assert.doesNotMatch(inCopy(project, ["cat-file", "commit", "HEAD"]), /^gpgsig/m);
    await assert.rejects(access(ran));
  });
});
