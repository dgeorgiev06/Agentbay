import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import { commitFiles, git, openRepositoryProject, refsAndWorktrees, writeFiles } from "./repository.ts";

const folder = ".forge/worktrees/feature";

const target = ".forge/targets/main";

type Files = Readonly<Record<string, string>>;

type Checkout = {
  readonly refsAndWorktrees: string;
  readonly head: string;
  readonly status: string;
  readonly files: Files;
};

const watched = ["README.md", "feature.txt", "notes.txt", "secret.env", "docs/guide.md"];

const outsideKernel = [".", ":(exclude).agentbay", ":(exclude).forge"];

async function filesIn(project: ModeProject, paths: readonly string[]): Promise<Files> {
  const present = paths.filter((path) => existsSync(join(project.root, path)));
  const texts = await Promise.all(present.map((path) => readFile(join(project.root, path), "utf8")));
  return Object.fromEntries(present.map((path, index) => [path, texts[index] ?? ""]));
}

function statusOf(project: ModeProject): string {
  return git(project, ".", ["status", "--porcelain=v1", "--untracked-files=all", "--", ...outsideKernel]);
}

async function checkoutOf(project: ModeProject): Promise<Checkout> {
  return {
    refsAndWorktrees: refsAndWorktrees(project),
    head: git(project, ".", ["symbolic-ref", "HEAD"]).trim(),
    status: git(project, ".", [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored",
      "--",
      ...outsideKernel,
    ]),
    files: await filesIn(project, watched),
  };
}

async function sliceWithCommit(project: ModeProject, files: Files): Promise<string> {
  await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
  return commitFiles(project, { folder, files, message: "Do the feature" });
}

function headOf(project: ModeProject, branch: string): string {
  return git(project, ".", ["rev-parse", "--verify", `refs/heads/${branch}`]).trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function whenTargetExists(project: ModeProject): Promise<void> {
  const stopAt = Date.now() + 60_000;
  while (!existsSync(join(project.root, target)) && Date.now() < stopAt) {
    await setImmediate();
  }
}

function landedOf(output: unknown): unknown {
  return typeof output === "object" && output !== null ? Reflect.get(output, "landed") : undefined;
}

test("merge into the branch the project's folder has checked out, with the folder clean, fast-forwards it to a merge commit made elsewhere, and the folder's files change to it", async () => {
  const project = await openRepositoryProject();
  try {
    const slice = await sliceWithCommit(project, { "feature.txt": "feature\n", "docs/guide.md": "guide\n" });
    await writeFiles(project, ".", { "notes.txt": "The owner's untracked notes.\n" });
    const output = await project.output("git-worktrees.merge", { folder, into: "main" });
    const commit = headOf(project, "main");
    assert.deepEqual(output, {
      how: "merged",
      branch: "forge/feature",
      into: "main",
      commit,
      landed: "checked-out-branch-fast-forwarded",
    });
    assert.equal(
      git(project, ".", ["log", "-1", "--format=%s|%P|%an <%ae>|%cn <%ce>", "main"]),
      `Merge branch 'forge/feature' into main|${project.base} ${slice}|` +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>|" +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n",
    );
    const after = await checkoutOf(project);
    assert.equal(after.head, "refs/heads/main");
    assert.equal(statusOf(project), "?? notes.txt\n");
    assert.deepEqual(after.files, {
      "README.md": "A small repository.\n",
      "feature.txt": "feature\n",
      "notes.txt": "The owner's untracked notes.\n",
      "docs/guide.md": "guide\n",
    });
    assert.equal(git(project, ".", ["diff", "--cached", "--name-only", "main"]), "");
    const worktrees = git(project, ".", ["worktree", "list", "--porcelain"]).split("\n");
    assert.equal(worktrees.filter((line) => line.startsWith("worktree ")).length, 2);
    assert.equal(await exists(join(project.root, target)), false);
  } finally {
    await project.close();
  }
});

test("an uncommitted change in the project's folder, staged or not, stops the fast-forward with a sentence naming it, and nothing changes anywhere", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const refused =
      "The project's folder has uncommitted changes to README.md, so main was not fast-forwarded and nothing " +
      "changed. Commit them or set them aside, then merge again.";
    await writeFiles(project, ".", { "README.md": "The owner's own change.\n" });
    const unstaged = await checkoutOf(project);
    assert.equal(statusOf(project), " M README.md\n");
    assert.equal(await project.failure("git-worktrees.merge", { folder, into: "main" }), refused);
    assert.deepEqual(await checkoutOf(project), unstaged);
    git(project, ".", ["add", "README.md"]);
    const staged = await checkoutOf(project);
    assert.equal(statusOf(project), "M  README.md\n");
    assert.equal(await project.failure("git-worktrees.merge", { folder, into: "main" }), refused);
    assert.deepEqual(await checkoutOf(project), staged);
    assert.equal(headOf(project, "main"), project.base);
  } finally {
    await project.close();
  }
});

test("an untracked or an ignored file where the merge puts a file stops the fast-forward with a sentence naming it, and the file is kept", async () => {
  const project = await openRepositoryProject();
  try {
    const exclude = join(project.root, git(project, ".", ["rev-parse", "--git-path", "info/exclude"]).trim());
    await mkdir(dirname(exclude), { recursive: true });
    await writeFile(exclude, "secret.env\n", "utf8");
    await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
    await writeFiles(project, folder, { "feature.txt": "feature\n", "secret.env": "slice\n" });
    git(project, folder, ["add", "--force", "feature.txt", "secret.env"]);
    git(project, folder, ["commit", "--quiet", "--message", "Do the feature"]);
    await writeFiles(project, ".", { "feature.txt": "The owner's file.\n", "secret.env": "The owner's secret.\n" });
    const before = await checkoutOf(project);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "main" }),
      "The project's folder has untracked or ignored files where the merge puts its own: feature.txt, secret.env, " +
        "so main was not fast-forwarded and nothing changed. Move them away, then merge again.",
    );
    assert.deepEqual(await checkoutOf(project), before);
    await writeFiles(project, ".", { "README.md": "The owner's own change.\n" });
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "main" }),
      "The project's folder has uncommitted changes to README.md, and untracked or ignored files where the merge " +
        "puts its own: feature.txt, secret.env, so main was not fast-forwarded and nothing changed. Commit them " +
        "or set them aside, move the others away, then merge again.",
    );
    assert.equal(headOf(project, "main"), project.base);
    assert.equal(await readFile(join(project.root, "secret.env"), "utf8"), "The owner's secret.\n");
  } finally {
    await project.close();
  }
});

test("an untracked folder where the merge puts a file stops the fast-forward, and an untracked file beside a file the merge adds does not", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "docs/guide.md": "guide\n", tools: "A file in the slice.\n" });
    await writeFiles(project, ".", { "docs/draft.md": "draft\n", "tools/run.sh": "run\n" });
    const before = await checkoutOf(project);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "main" }),
      "The project's folder has untracked or ignored files where the merge puts its own: tools/, so main was not " +
        "fast-forwarded and nothing changed. Move them away, then merge again.",
    );
    assert.deepEqual(await checkoutOf(project), before);
    await rm(join(project.root, "tools"), { recursive: true });
    const output = await project.output("git-worktrees.merge", { folder, into: "main" });
    assert.equal(landedOf(output), "checked-out-branch-fast-forwarded");
    assert.deepEqual(await filesIn(project, ["docs/draft.md", "docs/guide.md", "tools"]), {
      "docs/draft.md": "draft\n",
      "docs/guide.md": "guide\n",
      tools: "A file in the slice.\n",
    });
  } finally {
    await project.close();
  }
});

test("a checked-out branch that moves while the merge is made is not fast-forwarded, and the sentence says it moved", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const asked = project.failure("git-worktrees.merge", { folder, into: "main" });
    await whenTargetExists(project);
    const identity = ["-c", "user.name=Owner", "-c", "user.email=owner@example.com"];
    execFileSync("git", [...identity, "commit", "--quiet", "--allow-empty", "-m", "Move"], { cwd: project.root });
    const moved = headOf(project, "main");
    assert.equal(
      await asked,
      `The branch main moved from ${project.base.slice(0, 12)} to ${moved.slice(0, 12)} while the merge was made, ` +
        "so it was not fast-forwarded and nothing changed. Merge again to merge into where it is now.",
    );
    assert.equal(headOf(project, "main"), moved);
    assert.deepEqual((await checkoutOf(project)).files, { "README.md": "A small repository.\n" });
    assert.equal(statusOf(project), "");
    assert.equal(await exists(join(project.root, target)), false);
  } finally {
    await project.close();
  }
});

test("a project's folder switched to another branch while the merge is made is not fast-forwarded", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const asked = project.failure("git-worktrees.merge", { folder, into: "main" });
    await whenTargetExists(project);
    execFileSync("git", ["switch", "--quiet", "--create", "other"], { cwd: project.root });
    assert.equal(
      await asked,
      "The project's folder switched from main to other while the merge was made, so main was not fast-forwarded " +
        "and nothing changed. Switch back to main, then merge again.",
    );
    assert.equal(headOf(project, "main"), project.base);
    assert.equal(headOf(project, "other"), project.base);
    assert.equal(git(project, ".", ["symbolic-ref", "HEAD"]).trim(), "refs/heads/other");
  } finally {
    await project.close();
  }
});

test("no hook of the repository runs when the checked-out branch is fast-forwarded, from the hooks folder or from one the repository's configuration names", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    const names = ["post-merge", "post-checkout", "reference-transaction", "pre-merge-commit", "post-commit"];
    const marks = join(project.root, ".git");
    const configured = join(marks, "configured-hooks");
    await mkdir(configured, { recursive: true });
    const hooks = join(project.root, git(project, ".", ["rev-parse", "--git-path", "hooks"]).trim());
    const places = { default: hooks, configured };
    for (const [where, place] of Object.entries(places)) {
      for (const hook of names) {
        const file = join(place, hook);
        await writeFile(file, `#!/bin/sh\ntouch "${join(marks, `${where}-${hook}-ran`)}"\n`, "utf8");
        await chmod(file, 0o755);
      }
    }
    git(project, ".", ["config", "core.hooksPath", configured]);
    const output = await project.output("git-worktrees.merge", { folder, into: "main" });
    assert.equal(landedOf(output), "checked-out-branch-fast-forwarded");
    assert.equal(await readFile(join(project.root, "feature.txt"), "utf8"), "feature\n");
    const ran: string[] = [];
    for (const where of Object.keys(places)) {
      for (const hook of names) {
        if (await exists(join(marks, `${where}-${hook}-ran`))) {
          ran.push(`${where} ${hook}`);
        }
      }
    }
    assert.deepEqual(ran, []);
  } finally {
    await project.close();
  }
});

test("a branch checked out in another worktree than the project's folder is refused with its sentence, and it does not move", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "feature.txt": "feature\n" });
    await project.output("git-worktrees.cut", { slice: "elsewhere", base: "main" });
    const before = await checkoutOf(project);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "forge/elsewhere" }),
      "The branch forge/elsewhere is checked out in another worktree than the project's own folder, so " +
        "forge/feature is not merged into it. Switch that worktree to another branch, then merge again.",
    );
    assert.deepEqual(await checkoutOf(project), before);
  } finally {
    await project.close();
  }
});

test("a conflict with the checked-out branch leaves no merge in progress, no worktree of the mode's own and the folder as it was", async () => {
  const project = await openRepositoryProject();
  try {
    await sliceWithCommit(project, { "README.md": "The slice's line.\n" });
    await commitFiles(project, { files: { "README.md": "The owner's line.\n" }, message: "Change main" });
    const before = await checkoutOf(project);
    assert.equal(
      await project.failure("git-worktrees.merge", { folder, into: "main" }),
      "The branch forge/feature conflicts with main in README.md, so the merge was undone: main is as it was and " +
        "forge/feature is kept.",
    );
    assert.deepEqual(await checkoutOf(project), before);
    assert.throws(() => git(project, ".", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]));
    assert.equal(await exists(join(project.root, target)), false);
  } finally {
    await project.close();
  }
});
