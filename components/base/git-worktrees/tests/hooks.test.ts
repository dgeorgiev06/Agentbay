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
