import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

async function withProject(work: (project: ModeProject & { readonly base: string }) => Promise<void>): Promise<void> {
  const project = await openRepositoryProject();
  try {
    await work(project);
  } finally {
    await project.close();
  }
}

const readmePatch = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-A\n+B\n";

test("cut's refusals say which branch exists or which commit is missing", async () => {
  await withProject(async (project) => {
    await project.output("git-worktrees.cut", { slice: "again", base: project.base });
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "again", base: project.base }),
      "The branch forge/again already exists, so the slice again is not cut again.",
    );
    assert.equal(
      await project.failure("git-worktrees.cut", { slice: "lost", base: "no-such-branch" }),
      "There is no commit no-such-branch in the repository.",
    );
  });
});

test("status's refusals name a worktree the mode did not make, a copy and a worktree that no longer exists", async () => {
  await withProject(async (project) => {
    git(project, ".", ["worktree", "add", "--quiet", "--detach", ".forge/worktrees/by-hand", "main"]);
    assert.equal(
      await project.failure("git-worktrees.status", { folder: ".forge/worktrees/by-hand", base: "main" }),
      "The folder .forge/worktrees/by-hand was not made by this mode, so the mode does not look at it.",
    );
    await project.output("git-worktrees.copy", { commit: "main", name: "spare" });
    assert.equal(
      await project.failure("git-worktrees.status", { folder: ".forge/copies/spare", base: "main" }),
      "The folder .forge/copies/spare is a copy, not a worktree, so the mode does not look at it.",
    );
    await project.output("git-worktrees.cut", { slice: "lost", base: "main" });
    await rm(join(project.root, ".forge/worktrees/lost"), { recursive: true, force: true });
    assert.equal(
      await project.failure("git-worktrees.status", { folder: ".forge/worktrees/lost", base: "main" }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not look at it.",
    );
  });
});

test("changed's refusal names the commit that does not exist", async () => {
  await withProject(async (project) => {
    assert.equal(
      await project.failure("git-worktrees.changed", { from: "main", to: "nowhere" }),
      "There is no commit nowhere in the repository.",
    );
  });
});

test("copy's refusals name a path git does not ignore and a name in use", async () => {
  await withProject(async (project) => {
    await commitFiles(project, { files: { ".gitignore": ".agentbay/\n.forge/\ndeps/\n" }, message: "Ignore deps" });
    await writeFiles(project, ".", { "deps/package.txt": "installed\n", "loose.txt": "not committed\n" });
    assert.equal(
      await project.failure("git-worktrees.copy", { commit: "main", name: "refused", links: ["deps", "loose.txt"] }),
      "The path loose.txt is not ignored by git in the project, so the copy does not link to it.",
    );
    await project.output("git-worktrees.copy", { commit: "main", name: "twice" });
    assert.equal(
      await project.failure("git-worktrees.copy", { commit: "main", name: "twice" }),
      "The name twice is already in use by the copy .forge/copies/twice.",
    );
  });
});

test("overlay's refusals name a worktree and a copy that no longer exists", async () => {
  await withProject(async (project) => {
    await project.output("git-worktrees.cut", { slice: "busy", base: "main" });
    const overlay = { commit: "main", paths: ["README.md"] };
    assert.equal(
      await project.failure("git-worktrees.overlay", { folder: ".forge/worktrees/busy", ...overlay }),
      "The folder .forge/worktrees/busy is a worktree, not a copy, so the mode does not change it.",
    );
    await project.output("git-worktrees.copy", { commit: "main", name: "lost" });
    await rm(join(project.root, ".forge/copies/lost"), { recursive: true, force: true });
    assert.equal(
      await project.failure("git-worktrees.overlay", { folder: ".forge/copies/lost", ...overlay }),
      "The folder .forge/copies/lost was made by this mode but no longer exists, so the mode does not change it.",
    );
  });
});

test("remove's refusals say what keeps a worktree, and its forgetting says what was forgotten", async () => {
  await withProject(async (project) => {
    const folder = ".forge/worktrees/done";
    await project.output("git-worktrees.cut", { slice: "done", base: "main" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder }),
      "Name the branch that forge/done must be merged into, as into, to remove the worktree .forge/worktrees/done.",
    );
    await writeFiles(project, folder, { "README.md": "Not yet committed.\n" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      "The worktree .forge/worktrees/done has changed or untracked files, so it and its branch forge/done are kept.",
    );
    git(project, folder, ["checkout", "--", "README.md"]);
    await commitFiles(project, { folder, files: { "work.txt": "work\n" }, message: "Do the work" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      "The branch forge/done is not merged into main, so the worktree .forge/worktrees/done and its branch are kept.",
    );
    await writeFiles(project, folder, { "more.txt": "more\n" });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder, into: "main" }),
      "The worktree .forge/worktrees/done has changed or untracked files, and its branch forge/done is not " +
        "merged into main, so both are kept.",
    );
    await mkdir(join(project.root, "src"), { recursive: true });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder: "src" }),
      "The folder src was not made by this mode, so the mode does not remove it.",
    );
    await project.output("git-worktrees.cut", { slice: "lost", base: "main" });
    await rm(join(project.root, ".forge/worktrees/lost"), { recursive: true, force: true });
    assert.deepEqual(await project.output("git-worktrees.remove", { folder: ".forge/worktrees/lost", into: "main" }), {
      folder: ".forge/worktrees/lost",
      kind: "forgotten",
      reason:
        "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode forgets it. " +
        "Its branch forge/lost is kept.",
    });
    await project.output("git-worktrees.copy", { commit: "main", name: "lost" });
    await rm(join(project.root, ".forge/copies/lost"), { recursive: true, force: true });
    assert.deepEqual(await project.output("git-worktrees.remove", { folder: ".forge/copies/lost" }), {
      folder: ".forge/copies/lost",
      kind: "forgotten",
      reason: "The folder .forge/copies/lost was made by this mode but no longer exists, so the mode forgets it.",
    });
    assert.equal(
      await project.failure("git-worktrees.remove", { folder: ".forge/copies/lost" }),
      "The folder .forge/copies/lost was not made by this mode, so the mode does not remove it.",
    );
  });
});

test("merge's refusals name a missing target, a changed worktree, a checked-out target, a conflict and a lost worktree", async () => {
  await withProject(async (project) => {
    const folder = ".forge/worktrees/feature";
    await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
    await commitFiles(project, { folder, files: { "README.md": "The slice's line.\n" }, message: "Do the feature" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "There is no branch integration, so the mode has nothing to merge forge/feature into.",
    );
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "main" }),
      "The branch main is checked out in the project or in another worktree, and the mode merges only into a " +
        "branch it can check out in a worktree of its own, so forge/feature is not merged.",
    );
    git(project, ".", ["switch", "--quiet", "--create", "integration"]);
    await commitFiles(project, { files: { "README.md": "The target's line.\n" }, message: "Change integration" });
    git(project, ".", ["switch", "--quiet", "main"]);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "The branch forge/feature conflicts with integration in README.md, so the merge was undone: integration is " +
        "as it was and forge/feature is kept.",
    );
    await writeFiles(project, folder, { "README.md": "Not yet committed.\n" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "integration" }),
      "The worktree .forge/worktrees/feature has changed or untracked files, so its branch forge/feature is not " +
        "merged. Commit them or set them aside first.",
    );
    await project.output("git-worktrees.cut", { slice: "lost", base: "main" });
    await rm(join(project.root, ".forge/worktrees/lost"), { recursive: true, force: true });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder: ".forge/worktrees/lost", into: "integration" }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not merge it.",
    );
  });
});

test("set-aside's refusals name a copy and a worktree that no longer exists", async () => {
  await withProject(async (project) => {
    await project.output("git-worktrees.copy", { commit: "main", name: "spare" });
    assert.equal(
      await project.failure("git-worktrees.set-aside", { folder: ".forge/copies/spare" }),
      "The folder .forge/copies/spare is a copy, not a worktree, so the mode does not set aside the work of it.",
    );
    await project.output("git-worktrees.cut", { slice: "lost", base: "main" });
    await rm(join(project.root, ".forge/worktrees/lost"), { recursive: true, force: true });
    assert.equal(
      await project.failure("git-worktrees.set-aside", { folder: ".forge/worktrees/lost" }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not set aside " +
        "the work of it.",
    );
  });
});

test("apply's refusals give git's reason, and name a worktree and a copy that no longer exists", async () => {
  await withProject(async (project) => {
    await commitFiles(project, {
      files: { ".gitignore": ".agentbay/\n.forge/\ndeps/\n", "other.txt": "other\n" },
      message: "Files to patch",
    });
    await writeFiles(project, ".", { "deps/package.txt": "installed\n" });
    await project.output("git-worktrees.copy", { commit: "main", name: "patched", links: ["deps"] });
    const folder = ".forge/copies/patched";
    const unmatched =
      "diff --git a/other.txt b/other.txt\n--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n" +
      "-not what the file holds\n+changed\n";
    assert.equal(
      await project.failure("git-worktrees.apply", { folder, patch: unmatched }),
      "The patch does not apply to the copy, so nothing was changed: error: patch failed: other.txt:1",
    );
    const through =
      "diff --git a/deps/evil.txt b/deps/evil.txt\nnew file mode 100644\n--- /dev/null\n" +
      "+++ b/deps/evil.txt\n@@ -0,0 +1 @@\n+evil\n";
    assert.equal(
      await project.failure("git-worktrees.apply", { folder, patch: through }),
      "The patch does not apply to the copy, so nothing was changed: error: affected file 'deps/evil.txt' is " +
        "beyond a symbolic link",
    );
    await project.output("git-worktrees.cut", { slice: "busy", base: "main" });
    assert.equal(
      await project.failure("git-worktrees.apply", { folder: ".forge/worktrees/busy", patch: readmePatch }),
      "The folder .forge/worktrees/busy is a worktree, not a copy, so the mode does not apply a patch to it.",
    );
    await project.output("git-worktrees.copy", { commit: "main", name: "lost" });
    await rm(join(project.root, ".forge/copies/lost"), { recursive: true, force: true });
    assert.equal(
      await project.failure("git-worktrees.apply", { folder: ".forge/copies/lost", patch: readmePatch }),
      "The folder .forge/copies/lost was made by this mode but no longer exists, so the mode does not apply a " +
        "patch to it.",
    );
  });
});
