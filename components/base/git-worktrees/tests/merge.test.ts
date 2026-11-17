import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/mode-harness.ts";

const folder = ".forge/worktrees/feature";

type Snapshot = {
  readonly index: string;
  readonly head: string;
  readonly readme: string;
  readonly notes: string;
  readonly status: string;
};

async function ownersCheckout(project: ModeProject): Promise<Snapshot> {
  const index = await readFile(join(project.root, ".git/index"));
  return {
    index: createHash("sha256").update(index).digest("hex"),
    head: await readFile(join(project.root, ".git/HEAD"), "utf8"),
    readme: await readFile(join(project.root, "README.md"), "utf8"),
    notes: await readFile(join(project.root, "notes.txt"), "utf8"),
    status: git(project, ".", ["status", "--porcelain=v1", "--untracked-files=all"]),
  };
}

async function sliceWithCommit(project: ModeProject, files: Readonly<Record<string, string>>): Promise<string> {
  await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
  return commitFiles(project, { folder, files, message: "Do the feature" });
}

async function integrationWith(project: ModeProject, files: Readonly<Record<string, string>>): Promise<string> {
  git(project, ".", ["switch", "--quiet", "--create", "integration"]);
  const head = await commitFiles(project, { files, message: "Change integration" });
  git(project, ".", ["switch", "--quiet", "main"]);
  return head;
}

function worktrees(project: ModeProject): readonly string[] {
  return git(project, ".", ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).replace(project.root, "<project>"));
}

test("a clean merge makes a merge commit with two parents on the target, and the owner's checkout is as it was", async () => {
  const project = await openRepositoryProject();
  try {
    const sliceHead = await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const targetHead = await integrationWith(project, { "other.txt": "other\n" });
    await writeFiles(project, ".", { "README.md": "The owner's own change.\n", "notes.txt": "Not committed.\n" });
    const before = await ownersCheckout(project);
    const output = await project.output("git-worktrees.merge", { folder, into: "integration" });
    const commit = git(project, ".", ["rev-parse", "integration"]).trim();
    assert.deepEqual(output, { how: "merged", branch: "forge/feature", into: "integration", commit });
    assert.equal(
      git(project, ".", ["log", "-1", "--format=%P|%s|%an <%ae>|%cn <%ce>", "integration"]),
      `${targetHead} ${sliceHead}|Merge branch 'forge/feature' into integration|` +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>|" +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n",
    );
    assert.equal(git(project, ".", ["show", "integration:feature.txt"]), "feature\n");
    assert.deepEqual(await ownersCheckout(project), before);
    assert.deepEqual(worktrees(project), ["<project>", `<project>/${folder}`]);
  } finally {
    await project.close();
  }
});

test("a target with no commits of its own still gets a merge commit, not a fast-forward", async () => {
  const project = await openRepositoryProject();
  try {
    const sliceHead = await sliceWithCommit(project, { "feature.txt": "feature\n" });
    git(project, ".", ["branch", "integration", "main"]);
    const output = await project.output("git-worktrees.merge", { folder, into: "integration" });
    const commit = git(project, ".", ["rev-parse", "integration"]).trim();
    assert.deepEqual(output, { how: "merged", branch: "forge/feature", into: "integration", commit });
    assert.equal(git(project, ".", ["log", "-1", "--format=%P", "integration"]), `${project.base} ${sliceHead}\n`);
  } finally {
    await project.close();
  }
});

test("a conflict is refused with the paths named; the target, the slice's branch and the worktrees are as they were", async () => {
  const project = await openRepositoryProject();
  try {
    const sliceHead = await sliceWithCommit(project, { "README.md": "The slice's line.\n", "a.txt": "a\n" });
    const targetHead = await integrationWith(project, { "README.md": "The target's line.\n" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "The branch forge/feature conflicts with integration in README.md, so the merge was undone: integration is " +
        "as it was and forge/feature is kept.",
    );
    assert.equal(git(project, ".", ["rev-parse", "integration"]).trim(), targetHead);
    assert.equal(git(project, ".", ["rev-parse", "forge/feature"]).trim(), sliceHead);
    assert.deepEqual(worktrees(project), ["<project>", `<project>/${folder}`]);
    assert.equal(
      git(project, ".", ["for-each-ref", "--format=%(refname)", "refs/heads/integration"]),
      "refs/heads/integration\n",
    );
    assert.throws(() => git(project, ".", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]));
    assert.equal(git(project, folder, ["status", "--porcelain"]), "");
  } finally {
    await project.close();
  }
});

test("a slice whose worktree has a changed file is refused, and nothing is merged", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const targetHead = await integrationWith(project, { "other.txt": "other\n" });
    await writeFiles(project, folder, { "feature.txt": "Not yet committed.\n" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "The worktree .forge/worktrees/feature has changed or untracked files, so its branch forge/feature is not " +
        "merged. Commit them or set them aside first.",
    );
    assert.equal(git(project, ".", ["rev-parse", "integration"]).trim(), targetHead);
  } finally {
    await project.close();
  }
});

test("a target branch that does not exist is refused", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "There is no branch integration, so the mode has nothing to merge forge/feature into.",
    );
    assert.deepEqual(worktrees(project), ["<project>", `<project>/${folder}`]);
  } finally {
    await project.close();
  }
});

test("a folder left from an earlier merge into the target is said plainly, and nothing is merged", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const targetHead = await integrationWith(project, { "other.txt": "other\n" });
    await writeFiles(project, ".forge/targets/integration", { "left.txt": "left\n" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "The folder .forge/targets/integration is left from an earlier merge into integration, " +
        "so the mode does not merge until it is removed.",
    );
    assert.equal(git(project, ".", ["rev-parse", "integration"]).trim(), targetHead);
  } finally {
    await project.close();
  }
});

test("merging a slice already merged says so and makes no commit", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    await integrationWith(project, { "other.txt": "other\n" });
    const merged = await project.output("git-worktrees.merge", { folder, into: "integration" });
    const commit = git(project, ".", ["rev-parse", "integration"]).trim();
    assert.deepEqual(merged, { how: "merged", branch: "forge/feature", into: "integration", commit });
    assert.deepEqual(await project.output("git-worktrees.merge", { folder, into: "integration" }), {
      how: "already-merged",
      branch: "forge/feature",
      into: "integration",
      commit,
    });
    assert.equal(git(project, ".", ["rev-parse", "integration"]).trim(), commit);
  } finally {
    await project.close();
  }
});

test("a target that is checked out in the owner's checkout is refused, and the owner's checkout is as it was", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    await writeFiles(project, ".", { "notes.txt": "Not committed.\n" });
    const before = await ownersCheckout(project);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "main" }),
      "The branch main is checked out in the project or in another worktree, and the mode merges only into a " +
        "branch it can check out in a worktree of its own, so forge/feature is not merged.",
    );
    assert.equal(git(project, ".", ["rev-parse", "main"]).trim(), project.base);
    assert.deepEqual(await ownersCheckout(project), before);
    assert.deepEqual(worktrees(project), ["<project>", `<project>/${folder}`]);
  } finally {
    await project.close();
  }
});
