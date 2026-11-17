import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

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

test("the merge commit names the mode as its author and committer, and the owner's index is as it was", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    await integrationWith(project, { "other.txt": "other\n" });
    await writeFiles(project, ".", { "README.md": "The owner's own change.\n", "notes.txt": "Not committed.\n" });
    git(project, ".", ["add", "README.md"]);
    const before = await ownersCheckout(project);
    await project.output("git-worktrees.merge", { folder, into: "integration" });
    assert.equal(
      git(project, ".", ["log", "-1", "--format=%s|%an <%ae>|%cn <%ce>", "integration"]),
      "Merge branch 'forge/feature' into integration|" +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>|" +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n",
    );
    assert.deepEqual(await ownersCheckout(project), before);
    assert.deepEqual(worktrees(project), ["<project>", `<project>/${folder}`]);
  } finally {
    await project.close();
  }
});

test("a conflict leaves no merge in progress and no worktree of the mode's own", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "README.md": "The slice's line.\n" });
    await integrationWith(project, { "README.md": "The target's line.\n" });
    await project.failure("git-worktrees.merge", { folder, into: "integration" });
    assert.deepEqual(worktrees(project), ["<project>", `<project>/${folder}`]);
    assert.throws(() => git(project, ".", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]));
    assert.equal(git(project, folder, ["status", "--porcelain"]), "");
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
