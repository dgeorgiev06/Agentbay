import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import type { Change, Files, Repository, Start } from "../../interfaces/worktrees/tests/shared.ts";

const identity = ["-c", "user.name=Test Builder", "-c", "user.email=builder@example.com"];

const alwaysIgnored = [".agentbay/", ".forge/"];

type Environment = Readonly<Record<string, string>>;

function gitWith(
  project: ModeProject,
  folder: string,
  run: { readonly arguments: readonly string[]; readonly input?: string; readonly environment?: Environment },
): string {
  const environment = { ...process.env, ...run.environment };
  return execFileSync("git", [...identity, ...run.arguments], {
    cwd: join(project.root, folder),
    env: environment,
    ...(run.input === undefined ? {} : { input: run.input }),
  }).toString("utf8");
}

export function git(project: ModeProject, folder: string, gitArguments: readonly string[]): string {
  return gitWith(project, folder, { arguments: gitArguments });
}

export async function writeFiles(project: ModeProject, folder: string, files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(project.root, folder, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

export async function commitFiles(
  project: ModeProject,
  change: { readonly folder?: string; readonly files: Files; readonly message: string },
): Promise<string> {
  const folder = change.folder ?? ".";
  await writeFiles(project, folder, change.files);
  git(project, folder, ["add", "--all"]);
  git(project, folder, ["commit", "--quiet", "--allow-empty", "--message", change.message]);
  return git(project, folder, ["rev-parse", "HEAD"]).trim();
}

async function startedProject(
  modes: readonly string[],
  start: Start,
): Promise<{ readonly project: ModeProject; readonly base: string }> {
  const project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: [...modes] });
  git(project, ".", ["symbolic-ref", "HEAD", `refs/heads/${start.branch}`]);
  const ignored = [...alwaysIgnored, ...start.ignored].map((path) => `${path}\n`).join("");
  const base = await commitFiles(project, {
    files: { ".gitignore": ignored, ...start.files },
    message: "Start the repository",
  });
  return { project, base };
}

export async function openRepositoryProject(
  modes: readonly string[] = ["git-worktrees"],
): Promise<ModeProject & { readonly base: string }> {
  const { project, base } = await startedProject(modes, {
    branch: "main",
    files: { "README.md": "A small repository.\n" },
    ignored: [],
  });
  return { ...project, base };
}

export function refsAndWorktrees(project: ModeProject): string {
  const refs = git(project, ".", ["for-each-ref", "--format=%(refname) %(objectname)"]);
  return `${refs}${git(project, ".", ["worktree", "list", "--porcelain"])}`;
}

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

export async function startGitRepository(start: Start): Promise<Repository> {
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
