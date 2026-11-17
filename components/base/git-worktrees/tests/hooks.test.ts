import assert from "node:assert/strict";
import { access, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("no hook of the repository runs when a slice is cut", async () => {
  const project = await openRepositoryProject();
  try {
    const hooks = git(project, ".", ["rev-parse", "--git-path", "hooks"]).trim();
    for (const hook of ["post-checkout", "reference-transaction"]) {
      const file = join(project.root, hooks, hook);
      await writeFile(file, `#!/bin/sh\ntouch "${join(project.root, `${hook}-ran`)}"\n`, "utf8");
      await chmod(file, 0o755);
    }
    await project.output("git-worktrees.cut", { slice: "hooked", base: "main" });
    assert.deepEqual(
      [
        await exists(join(project.root, "post-checkout-ran")),
        await exists(join(project.root, "reference-transaction-ran")),
      ],
      [false, false],
    );
  } finally {
    await project.close();
  }
});

test("a file-system monitor named in the repository's configuration does not run", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "watched", base: "main" });
    const monitor = join(project.root, git(project, ".", ["rev-parse", "--git-path", "fsmonitor-probe"]).trim());
    const ran = join(project.root, "fsmonitor-ran");
    await writeFile(monitor, `#!/bin/sh\ntouch "${ran}"\n`, "utf8");
    await chmod(monitor, 0o755);
    git(project, ".", ["config", "core.fsmonitor", monitor]);
    await project.output("git-worktrees.status", { folder: ".forge/worktrees/watched", base: "main" });
    assert.equal(await exists(ran), false);
  } finally {
    await project.close();
  }
});

test("a repository whose own configuration names a filter is refused, and the filter does not run", async () => {
  const project = await openRepositoryProject();
  try {
    const ran = join(project.root, "filter-ran");
    git(project, ".", ["config", "filter.evil.smudge", `sh -c 'touch "${ran}"; cat'`]);
    const attributes = git(project, ".", ["rev-parse", "--git-path", "info/attributes"]).trim();
    await writeFile(join(project.root, attributes), "*.md filter=evil\n", "utf8");
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "filtered", base: "main" }),
      "The repository's own configuration names filter.evil.smudge. git could run the command of such a filter " +
        "or merge driver, so the mode does nothing in this repository until it is removed.",
    );
    assert.equal(await exists(ran), false);
  } finally {
    await project.close();
  }
});

test("a repository whose own configuration names a merge driver is refused, and the driver does not run", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "driven", base: "main" });
    await commitFiles(project, {
      folder: ".forge/worktrees/driven",
      files: { "README.md": "The slice's line.\n" },
      message: "Change the slice",
    });
    git(project, ".", ["switch", "--quiet", "--create", "integration"]);
    await commitFiles(project, { files: { "README.md": "The target's line.\n" }, message: "Change the target" });
    git(project, ".", ["switch", "--quiet", "main"]);
    const ran = join(project.root, "driver-ran");
    git(project, ".", ["config", "merge.evil.driver", `touch "${ran}"; false`]);
    const attributes = git(project, ".", ["rev-parse", "--git-path", "info/attributes"]).trim();
    await writeFile(join(project.root, attributes), "*.md merge=evil\n", "utf8");
    assert.equal(
      await project.failure("git-worktrees.merge", { folder: ".forge/worktrees/driven", into: "integration" }),
      "The repository's own configuration names merge.evil.driver. git could run the command of such a filter " +
        "or merge driver, so the mode does nothing in this repository until it is removed.",
    );
    assert.equal(await exists(ran), false);
  } finally {
    await project.close();
  }
});

test("no hook runs when a slice is merged or its work is set aside", async () => {
  const project = await openRepositoryProject();
  try {
    const folder = ".forge/worktrees/hooked";
    await project.output("git-worktrees.cut", { slice: "hooked", base: "main" });
    await commitFiles(project, { folder, files: { "work.txt": "work\n" }, message: "Do the work" });
    git(project, ".", ["branch", "integration", project.base]);
    const hooks = git(project, ".", ["rev-parse", "--git-path", "hooks"]).trim();
    const names = ["pre-commit", "commit-msg", "pre-merge-commit", "post-merge"];
    for (const hook of names) {
      const file = join(project.root, hooks, hook);
      await writeFile(file, `#!/bin/sh\ntouch "${join(project.root, `${hook}-ran`)}"\n`, "utf8");
      await chmod(file, 0o755);
    }
    await writeFiles(project, folder, { "more.txt": "more\n" });
    await project.output("git-worktrees.set-aside", { folder });
    await project.output("git-worktrees.merge", { folder, into: "integration" });
    const ran: boolean[] = [];
    for (const hook of names) {
      ran.push(await exists(join(project.root, `${hook}-ran`)));
    }
    assert.deepEqual(ran, [false, false, false, false]);
  } finally {
    await project.close();
  }
});
