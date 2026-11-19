import assert from "node:assert/strict";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, refsAndWorktrees, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

const folder = ".forge/worktrees/tests";

const kept = { folder, branchAfter: "kept" };

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function withSlice(work: (project: ModeProject, head: string) => Promise<void>): Promise<void> {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "tests", base: "main" });
    const head = await commitFiles(project, {
      folder,
      files: { "tests/slice.test.ts": "the slice's tests\n" },
      message: "Add the slice's tests",
    });
    await work(project, head);
  } finally {
    await project.close();
  }
}

function branchHead(project: ModeProject): string {
  return git(project, ".", ["rev-parse", "--verify", "refs/heads/forge/tests"]).trim();
}

async function heldAsItWas(project: ModeProject, before: string): Promise<void> {
  assert.equal(refsAndWorktrees(project), before);
  assert.equal(await exists(join(project.root, folder)), true);
}

test("a worktree whose branch is not merged is removed with the branch kept at its commit, and git no longer lists it", async () => {
  await withSlice(async (project, head) => {
    assert.deepEqual(await project.output("git-worktrees.remove", kept), {
      folder,
      kind: "worktree",
      branch: "forge/tests",
      branchAfter: "kept",
      commit: head,
    });
    assert.equal(await exists(join(project.root, folder)), false);
    assert.equal(branchHead(project), head);
    assert.equal(git(project, ".", ["show", `${head}:tests/slice.test.ts`]), "the slice's tests\n");
    assert.doesNotMatch(git(project, ".", ["worktree", "list", "--porcelain"]), /forge\/tests/);
    assert.equal(git(project, ".", ["rev-parse", "main"]).trim(), git(project, ".", ["rev-parse", "HEAD"]).trim());
    assert.equal(
      await project.failure("git-worktrees.remove", kept),
      `The folder ${folder} was not made by this mode, so the mode does not remove it.`,
    );
  });
});

test("with the branch kept, a worktree with a changed or an untracked file is refused with today's sentence, and nothing moves", async () => {
  await withSlice(async (project) => {
    const before = refsAndWorktrees(project);
    const refused = `The worktree ${folder} has changed or untracked files, so it and its branch forge/tests are kept.`;
    await writeFiles(project, folder, { "notes.txt": "Not committed.\n" });
    assert.equal(await project.failure("git-worktrees.remove", kept), refused);
    await heldAsItWas(project, before);
    git(project, folder, ["clean", "--force", "--quiet"]);
    await writeFiles(project, folder, { "tests/slice.test.ts": "changed, not committed\n" });
    assert.equal(await project.failure("git-worktrees.remove", kept), refused);
    await heldAsItWas(project, before);
    git(project, folder, ["add", "--all"]);
    assert.equal(await project.failure("git-worktrees.remove", kept), refused);
    await heldAsItWas(project, before);
  });
});

test("with the branch kept, into is not given", async () => {
  await withSlice(async (project) => {
    const before = refsAndWorktrees(project);
    assert.equal(
      await project.failure("git-worktrees.remove", { ...kept, into: "main" }),
      `With branchAfter kept, into is not given, so the worktree ${folder} and its branch forge/tests are kept.`,
    );
    await heldAsItWas(project, before);
  });
});

test("with the branch kept, a worktree at a commit its branch does not hold is refused, so that commit is not lost", async () => {
  await withSlice(async (project) => {
    git(project, folder, ["switch", "--quiet", "--detach"]);
    const loose = await commitFiles(project, { folder, files: { "loose.txt": "only here\n" }, message: "Loose" });
    const before = refsAndWorktrees(project);
    assert.equal(
      await project.failure("git-worktrees.remove", kept),
      `The worktree ${folder} is at the commit ${loose}, which its branch forge/tests does not hold, so the ` +
        "worktree and its branch are kept.",
    );
    await heldAsItWas(project, before);
  });
});

test("with the branch kept, a worktree switched to an older commit of its branch is removed, and the branch stays at its head", async () => {
  await withSlice(async (project, head) => {
    git(project, folder, ["switch", "--quiet", "--detach", "HEAD~1"]);
    const output = await project.output("git-worktrees.remove", kept);
    assert.deepEqual(output, { folder, kind: "worktree", branch: "forge/tests", branchAfter: "kept", commit: head });
    assert.equal(branchHead(project), head);
  });
});

test("with the branch kept, a repository whose own configuration names a filter is refused, and the worktree stays", async () => {
  await withSlice(async (project) => {
    const ran = join(project.root, "filter-ran");
    git(project, ".", ["config", "filter.evil.clean", `sh -c 'touch "${ran}"; cat'`]);
    const attributes = git(project, ".", ["rev-parse", "--git-path", "info/attributes"]).trim();
    await writeFile(join(project.root, attributes), "*.ts filter=evil\n", "utf8");
    const before = refsAndWorktrees(project);
    assert.equal(
      await project.failure("git-worktrees.remove", kept),
      "The repository's own configuration names filter.evil.clean. git could run the command of such a filter " +
        "or merge driver, so the mode does nothing in this repository until it is removed.",
    );
    await heldAsItWas(project, before);
    assert.equal(await exists(ran), false);
  });
});

test("with the branch deleted named, a worktree is removed as without it: with its branch, only when merged", async () => {
  await withSlice(async (project) => {
    const deleted = { folder, into: "main", branchAfter: "deleted" };
    assert.equal(
      await project.failure("git-worktrees.remove", deleted),
      `The branch forge/tests is not merged into main, so the worktree ${folder} and its branch are kept.`,
    );
    git(project, ".", ["merge", "--quiet", "--ff-only", "forge/tests"]);
    assert.deepEqual(await project.output("git-worktrees.remove", deleted), {
      folder,
      kind: "worktree",
      branch: "forge/tests",
      branchAfter: "deleted",
    });
    assert.equal(git(project, ".", ["branch", "--list", "forge/*"]), "");
  });
});
