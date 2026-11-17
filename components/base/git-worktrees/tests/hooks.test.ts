import assert from "node:assert/strict";
import { access, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { git, openRepositoryProject } from "./repository.ts";

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
      "The repository's own configuration names filter.evil.smudge. git could run such a filter's command, " +
        "so the mode does nothing in this repository until it is removed.",
    );
    assert.equal(await exists(ran), false);
  } finally {
    await project.close();
  }
});
