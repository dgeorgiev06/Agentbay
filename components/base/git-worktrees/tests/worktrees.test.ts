import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  testWorktrees,
  type Change,
  type Files,
  type Repository,
  type Start,
} from "../../interfaces/worktrees/tests/shared.ts";
import { git, gitWith, startedProject, writeFiles } from "./repository.ts";

function headOf(project: ModeProject, branch: string): string | undefined {
  try {
    return git(project, ".", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).trim();
  } catch {
    return undefined;
  }
}

function checkedOut(project: ModeProject): string {
  return git(project, ".", ["symbolic-ref", "--short", "HEAD"]).trim();
}

async function committedInFolder(project: ModeProject, folder: string, change: Change): Promise<string> {
  await writeFiles(project, folder, change.files);
  for (const path of change.deleted) {
    await rm(join(project.root, folder, path), { force: true });
  }
  const paths = [...Object.keys(change.files), ...change.deleted];
  git(project, folder, ["add", "--all", "--", ...paths]);
  git(project, folder, ["commit", "--quiet", "--allow-empty", "--message", change.message, "--", ...paths]);
  return git(project, folder, ["rev-parse", "HEAD"]).trim();
}

async function committedOnBranch(project: ModeProject, branch: string, change: Change): Promise<string> {
  const head = headOf(project, branch) ?? "";
  const scratch = await mkdtemp(join(tmpdir(), "agentbay-index-"));
  const environment = { GIT_INDEX_FILE: join(scratch, "index") };
  const run = (gitArguments: readonly string[], input?: string): string =>
    gitWith(project, ".", { arguments: gitArguments, environment, ...(input === undefined ? {} : { input }) }).trim();
  try {
    run(["read-tree", head]);
    for (const [path, text] of Object.entries(change.files)) {
      const blob = run(["hash-object", "-w", "--stdin"], text);
      run(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
    }
    for (const path of change.deleted) {
      run(["update-index", "--force-remove", "--", path]);
    }
    const tree = run(["write-tree"]);
    const commit = run(["commit-tree", tree, "-p", head, "-m", change.message]);
    run(["update-ref", `refs/heads/${branch}`, commit, head]);
    return commit;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function filesOf(project: ModeProject, commit: string): Files {
  const paths = git(project, ".", ["ls-tree", "-r", "-z", "--name-only", commit])
    .split("\0")
    .filter((path) => path !== "");
  return Object.fromEntries(paths.map((path) => [path, git(project, ".", ["show", `${commit}:${path}`])]));
}

async function startGitRepository(start: Start): Promise<Repository> {
  const { project, base } = await startedProject(["git-worktrees"], start);
  return {
    project,
    base,
    commit: (change) => {
      if ("folder" in change.on) {
        return committedInFolder(project, change.on.folder, change);
      }
      const { branch } = change.on;
      return branch === checkedOut(project)
        ? committedInFolder(project, ".", change)
        : committedOnBranch(project, branch, change);
    },
    makeBranch: (branch, commit) => {
      git(project, ".", ["branch", "--", branch, commit]);
      return Promise.resolve();
    },
    headOf: (branch) => Promise.resolve(headOf(project, branch)),
    parentsOf: (commit) =>
      Promise.resolve(git(project, ".", ["rev-list", "--parents", "-n", "1", commit]).trim().split(" ").slice(1)),
    filesOf: (commit) => Promise.resolve(filesOf(project, commit)),
    checkedOut: () => Promise.resolve(checkedOut(project)),
  };
}

testWorktrees({ mode: "git-worktrees", ownData: [".git"], start: startGitRepository });
