import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commitFiles, git, openRepositoryProject, writeFiles } from "./repository.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";

const folder = ".forge/worktrees/feature";

const mode = "agentbay-git-worktrees <git-worktrees@agentbay.invalid>";

type Project = ModeProject & { readonly base: string };

async function withSlice(work: (project: Project) => Promise<void>): Promise<void> {
  const project = await openRepositoryProject();
  try {
    await commitFiles(project, {
      files: { ".gitignore": ".agentbay/\n.forge/\nrun.log\n", "src/main.txt": "main\n" },
      message: "Ignore the run log",
    });
    await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
    await work({ ...project, base: git(project, ".", ["rev-parse", "main"]).trim() });
  } finally {
    await project.close();
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function headOf(project: ModeProject, reference: string): string {
  return git(project, ".", ["rev-parse", reference]).trim();
}

function treeOf(project: ModeProject, commit: string): string {
  return git(project, ".", ["ls-tree", "-r", commit]).replace(/ [0-9a-f]{40}\t/g, "\t");
}

async function ownersCheckout(project: ModeProject): Promise<string> {
  const index = await readFile(join(project.root, ".git/index"));
  return [
    createHash("sha256").update(index).digest("hex"),
    await readFile(join(project.root, ".git/HEAD"), "utf8"),
    headOf(project, "main"),
    git(project, ".", ["status", "--porcelain=v1", "--untracked-files=all"]),
  ].join("\n");
}

test("a worktree with a changed and an untracked file is clean after commit, its branch one commit ahead, and the files still in the folder", async () => {
  await withSlice(async (project) => {
    const owner = await ownersCheckout(project);
    await writeFiles(project, folder, { "src/main.txt": "changed\n", "notes/new.txt": "new\n", "run.log": "log\n" });
    const message = "Build the feature\n\nThe first round of the builder's work.\nIt keeps # this line.";
    const output = await project.output("git-worktrees.commit", { folder, message });
    const commit = headOf(project, "forge/feature");
    assert.deepEqual(output, { how: "committed", folder, branch: "forge/feature", commit });
    assert.equal(git(project, ".", ["rev-list", "--parents", "-n", "1", commit]), `${commit} ${project.base}\n`);
    assert.equal(git(project, ".", ["log", "-1", "--format=%B", commit]), `${message}\n\n`);
    assert.equal(git(project, ".", ["log", "-1", "--format=%an <%ae>|%cn <%ce>", commit]), `${mode}|${mode}\n`);
    assert.equal(git(project, ".", ["cat-file", "commit", commit]).includes("gpgsig"), false);
    assert.equal(
      treeOf(project, commit),
      "100644 blob\t.gitignore\n100644 blob\tREADME.md\n100644 blob\tagentbay.config.yaml\n100644 blob\tnotes/new.txt\n100644 blob\tsrc/main.txt\n",
    );
    assert.equal(
      git(project, folder, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]),
      "!! run.log\n",
    );
    assert.equal(git(project, folder, ["symbolic-ref", "HEAD"]), "refs/heads/forge/feature\n");
    assert.deepEqual(
      [
        await readFile(join(project.root, folder, "src/main.txt"), "utf8"),
        await readFile(join(project.root, folder, "notes/new.txt"), "utf8"),
        await readFile(join(project.root, folder, "run.log"), "utf8"),
      ],
      ["changed\n", "new\n", "log\n"],
    );
    assert.equal(await ownersCheckout(project), owner);
  });
});

test("with nothing but an ignored file, commit makes no commit and gives the branch's head", async () => {
  await withSlice(async (project) => {
    await writeFiles(project, folder, { "run.log": "log\n" });
    assert.deepEqual(await project.output("git-worktrees.commit", { folder, message: "Nothing" }), {
      how: "nothing-changed",
      folder,
      branch: "forge/feature",
      commit: project.base,
    });
    assert.equal(headOf(project, "forge/feature"), project.base);
    assert.equal(git(project, ".", ["rev-list", "--count", "--all"]), "2\n");
  });
});

test("a worktree switched to another name for its head commits to the slice's own branch and is back on it", async () => {
  await withSlice(async (project) => {
    git(project, folder, ["switch", "--quiet", "--create", "other"]);
    await writeFiles(project, folder, { "one.txt": "one\n" });
    const first = await project.output("git-worktrees.commit", { folder, message: "On another branch" });
    assert.deepEqual(first, {
      how: "committed",
      folder,
      branch: "forge/feature",
      commit: headOf(project, "forge/feature"),
    });
    assert.equal(headOf(project, "other"), project.base);
    git(project, folder, ["switch", "--quiet", "--detach"]);
    await writeFiles(project, folder, { "two.txt": "two\n" });
    const second = await project.output("git-worktrees.commit", { folder, message: "Detached" });
    const head = headOf(project, "forge/feature");
    assert.deepEqual(second, { how: "committed", folder, branch: "forge/feature", commit: head });
    assert.equal(git(project, ".", ["rev-list", "--count", `${project.base}..${head}`]), "2\n");
    assert.equal(git(project, folder, ["symbolic-ref", "HEAD"]), "refs/heads/forge/feature\n");
    assert.equal(headOf(project, "main"), project.base);
  });
});

test("a worktree whose head is not its branch's head is refused, and nothing is committed or staged", async () => {
  await withSlice(async (project) => {
    const head = await commitFiles(project, { folder, files: { "work.txt": "work\n" }, message: "Do the work" });
    git(project, folder, ["switch", "--quiet", "--detach", project.base]);
    await writeFiles(project, folder, { "more.txt": "more\n" });
    assert.equal(
      await project.failure("git-worktrees.commit", { folder, message: "Elsewhere" }),
      `The worktree ${folder} is not at the head of its branch forge/feature, so nothing is committed.`,
    );
    assert.equal(headOf(project, "forge/feature"), head);
    assert.equal(git(project, folder, ["status", "--porcelain=v1", "--untracked-files=all"]), "?? more.txt\n");
  });
});

test("commit's refusals name a folder the mode did not make, a copy and a worktree that no longer exists", async () => {
  await withSlice(async (project) => {
    git(project, ".", ["worktree", "add", "--quiet", "--detach", ".forge/worktrees/by-hand", "main"]);
    await writeFiles(project, ".forge/worktrees/by-hand", { "new.txt": "new\n" });
    assert.equal(
      await project.failure("git-worktrees.commit", { folder: ".forge/worktrees/by-hand", message: "By hand" }),
      "The folder .forge/worktrees/by-hand was not made by this mode, so the mode does not commit the work in it.",
    );
    assert.equal(
      await project.failure("git-worktrees.commit", { folder: "src", message: "The project" }),
      "The folder src was not made by this mode, so the mode does not commit the work in it.",
    );
    await project.output("git-worktrees.copy", { commit: "main", name: "spare" });
    assert.equal(
      await project.failure("git-worktrees.commit", { folder: ".forge/copies/spare", message: "A copy" }),
      "The folder .forge/copies/spare is a copy, not a worktree, so the mode does not commit the work in it.",
    );
    await project.output("git-worktrees.cut", { slice: "lost", base: "main" });
    await rm(join(project.root, ".forge/worktrees/lost"), { recursive: true, force: true });
    assert.equal(
      await project.failure("git-worktrees.commit", { folder: ".forge/worktrees/lost", message: "Lost" }),
      "The folder .forge/worktrees/lost was made by this mode but no longer exists, so the mode does not commit " +
        "the work in it.",
    );
    assert.equal(git(project, ".", ["rev-list", "--count", "--all"]), "2\n");
  });
});

test("a link pointing outside the worktree is committed as a link, and nothing beyond it is followed", async () => {
  await withSlice(async (project) => {
    const outside = await mkdtemp(join(tmpdir(), "agentbay-outside-"));
    try {
      await writeFile(join(outside, "main.txt"), "a secret outside\n", "utf8");
      await rm(join(project.root, folder, "src"), { recursive: true, force: true });
      await symlink(outside, join(project.root, folder, "src"));
      await symlink(join(outside, "main.txt"), join(project.root, folder, "secret.txt"));
      await project.output("git-worktrees.commit", { folder, message: "Link outside" });
      const commit = headOf(project, "forge/feature");
      assert.equal(
        treeOf(project, commit),
        "100644 blob\t.gitignore\n100644 blob\tREADME.md\n100644 blob\tagentbay.config.yaml\n120000 blob\tsecret.txt\n120000 blob\tsrc\n",
      );
      assert.deepEqual(
        [git(project, ".", ["show", `${commit}:src`]), git(project, ".", ["show", `${commit}:secret.txt`])],
        [outside, join(outside, "main.txt")],
      );
      assert.equal(await readFile(join(outside, "main.txt"), "utf8"), "a secret outside\n");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("no hook and no signing program runs when commit commits, and attributes in the worktree change no byte", async () => {
  await withSlice(async (project) => {
    const hooks = git(project, ".", ["rev-parse", "--git-path", "hooks"]).trim();
    const names = ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "reference-transaction"];
    for (const hook of names) {
      const file = join(project.root, hooks, hook);
      await writeFile(file, `#!/bin/sh\ntouch "${join(project.root, `${hook}-ran`)}"\n`, "utf8");
      await chmod(file, 0o755);
    }
    const signer = join(project.root, ".git", "signer");
    await writeFile(signer, `#!/bin/sh\ntouch "${join(project.root, "signer-ran")}"\nexit 1\n`, "utf8");
    await chmod(signer, 0o755);
    git(project, ".", ["config", "commit.gpgSign", "true"]);
    git(project, ".", ["config", "gpg.program", signer]);
    await writeFiles(project, folder, { ".gitattributes": "*.txt text eol=crlf\n", "lines.txt": "one\r\ntwo\r\n" });
    const output = await project.output("git-worktrees.commit", { folder, message: "Hooked" });
    assert.equal(fieldOf(output, "how"), "committed");
    const ran: boolean[] = [];
    for (const name of [...names, "signer"]) {
      ran.push(await exists(join(project.root, `${name}-ran`)));
    }
    assert.deepEqual(ran, [false, false, false, false, false, false]);
    assert.equal(git(project, ".", ["show", "forge/feature:lines.txt"]), "one\r\ntwo\r\n");
  });
});

test("a repository whose own configuration names a filter is refused by commit, and the filter does not run", async () => {
  await withSlice(async (project) => {
    const ran = join(project.root, "filter-ran");
    git(project, ".", ["config", "filter.evil.clean", `sh -c 'touch "${ran}"; cat'`]);
    await mkdir(join(project.root, folder, "notes"), { recursive: true });
    await writeFiles(project, folder, { ".gitattributes": "* filter=evil\n", "notes/new.txt": "new\n" });
    assert.equal(
      await project.failure("git-worktrees.commit", { folder, message: "Filtered" }),
      "The repository's own configuration names filter.evil.clean. git could run the command of such a filter " +
        "or merge driver, so the mode does nothing in this repository until it is removed.",
    );
    assert.equal(await exists(ran), false);
    assert.equal(headOf(project, "forge/feature"), project.base);
  });
});
