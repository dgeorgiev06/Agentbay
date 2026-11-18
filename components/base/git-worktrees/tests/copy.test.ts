import assert from "node:assert/strict";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import { git, gitWith, openRepositoryProject, refsAndWorktrees, writeFiles } from "./repository.ts";

const folder = ".forge/copies/checked";

const unsigned = ["-c", "commit.gpgsign=false"];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function listedIn(project: ModeProject, at: string): readonly string[] {
  return git(project, at, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter((path) => path !== "");
}

function inCopy(project: ModeProject, gitArguments: readonly string[]): string {
  return git(project, folder, gitArguments).trim();
}

async function committedWithIgnoredFiles(project: ModeProject): Promise<string> {
  await writeFiles(project, ".", {
    ".gitignore": ".agentbay/\n.forge/\ndeps/\nbuild/\n",
    "src/main.txt": "main\n",
    "build/kept.txt": "committed though ignored\n",
    "deps/package.txt": "installed\n",
  });
  git(project, ".", ["add", "--all"]);
  git(project, ".", ["add", "--force", "build/kept.txt"]);
  gitWith(project, ".", { arguments: [...unsigned, "commit", "--quiet", "--message", "Ignore deps and build"] });
  return git(project, ".", ["rev-parse", "HEAD"]).trim();
}

function hasObject(project: ModeProject, hash: string): boolean {
  try {
    git(project, ".", ["cat-file", "-e", hash]);
    return true;
  } catch {
    return false;
  }
}

function projectState(project: ModeProject): readonly string[] {
  return [
    git(project, ".", ["status", "--porcelain=v1", "--untracked-files=all"]),
    refsAndWorktrees(project),
    git(project, ".", ["count-objects", "-v"]),
    git(project, ".", ["rev-parse", "--git-path", "index"]),
  ];
}

test("a copy is the top of a repository of its own, holding the commit's files as one commit, clean, with its links ignored", async () => {
  const project = await openRepositoryProject();
  try {
    const commit = await committedWithIgnoredFiles(project);
    await project.output("git-worktrees.copy", { commit: "main", name: "checked", links: ["deps"] });
    assert.equal(inCopy(project, ["rev-parse", "--show-toplevel"]), join(project.root, folder));
    assert.deepEqual(listedIn(project, folder), [
      ".gitignore",
      "README.md",
      "agentbay.config.yaml",
      "build/kept.txt",
      "src/main.txt",
    ]);
    assert.equal(inCopy(project, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
    assert.equal(inCopy(project, ["check-ignore", "deps"]), "deps");
    assert.equal(inCopy(project, ["rev-list", "--count", "HEAD"]), "1");
    assert.equal(inCopy(project, ["rev-parse", "HEAD^{tree}"]), git(project, ".", ["rev-parse", "main^{tree}"]).trim());
    assert.equal(
      inCopy(project, ["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B"]),
      "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n" +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n" +
        `A throwaway copy of ${commit}.`,
    );
    assert.doesNotMatch(inCopy(project, ["cat-file", "commit", "HEAD"]), /^gpgsig/m);
  } finally {
    await project.close();
  }
});

test("a project whose configuration demands signing and names hooks and a template gets a copy with nothing signed and no hook run", async () => {
  const project = await openRepositoryProject();
  try {
    const ran = (what: string): string => join(project.root, `${what}-ran`);
    const writesMark = (what: string): string => `#!/bin/sh\ntouch "${ran(what)}"\n`;
    const signer = join(project.root, "signer.sh");
    await writeFile(signer, writesMark("signer"), "utf8");
    await chmod(signer, 0o755);
    const template = join(project.root, "template");
    const hooks = join(project.root, "hooks");
    const names = ["pre-commit", "commit-msg", "post-commit", "post-checkout", "reference-transaction"];
    for (const [place, what] of [
      [join(template, "hooks"), "template"],
      [hooks, "hook"],
    ] as const) {
      await mkdir(place, { recursive: true });
      for (const name of names) {
        await writeFile(join(place, name), writesMark(`${what}-${name}`), "utf8");
        await chmod(join(place, name), 0o755);
      }
    }
    const settings: readonly (readonly [string, string])[] = [
      ["commit.gpgsign", "true"],
      ["gpg.format", "openpgp"],
      ["gpg.program", signer],
      ["user.signingkey", "someone"],
      ["core.hooksPath", hooks],
      ["init.templateDir", template],
    ];
    for (const [key, value] of settings) {
      git(project, ".", ["config", key, value]);
    }
    await project.output("git-worktrees.copy", { commit: project.base, name: "checked" });
    const patch =
      "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-A small repository.\n+B\n";
    await project.output("git-worktrees.apply", { folder, patch });
    await project.output("git-worktrees.overlay", { folder, commit: project.base, paths: ["README.md"] });
    const commits = inCopy(project, ["rev-list", "HEAD"]).split("\n");
    assert.equal(commits.length, 3);
    for (const commit of commits) {
      assert.doesNotMatch(inCopy(project, ["cat-file", "commit", commit]), /^gpgsig/m);
    }
    const marks = ["signer", ...names.map((name) => `template-${name}`), ...names.map((name) => `hook-${name}`)];
    const found: string[] = [];
    for (const mark of marks) {
      if (await exists(ran(mark))) {
        found.push(mark);
      }
    }
    assert.deepEqual(found, []);
    assert.equal(await exists(join(project.root, folder, ".git/hooks")), false);
  } finally {
    await project.close();
  }
});

test("the project's status, refs, worktrees and objects are the same after a copy, a commit, a branch, a reset and a clean inside it, and its removal", async () => {
  const project = await openRepositoryProject();
  try {
    const before = projectState(project);
    await project.output("git-worktrees.copy", { commit: "main", name: "checked" });
    await writeFiles(project, folder, { "made.txt": "made in the copy\n" });
    git(project, folder, ["add", "--all"]);
    gitWith(project, folder, { arguments: [...unsigned, "commit", "--quiet", "--message", "Made in the copy"] });
    git(project, folder, ["branch", "elsewhere"]);
    const madeInside = inCopy(project, ["rev-parse", "elsewhere"]);
    git(project, folder, ["reset", "--quiet", "--hard", "HEAD~1"]);
    await writeFiles(project, folder, { "loose.txt": "loose\n" });
    git(project, folder, ["clean", "--quiet", "-fdx"]);
    assert.deepEqual(projectState(project), before);
    assert.equal(hasObject(project, madeInside), false);
    await project.output("git-worktrees.remove", { folder });
    assert.equal(await exists(join(project.root, folder)), false);
    assert.deepEqual(projectState(project), before);
  } finally {
    await project.close();
  }
});
