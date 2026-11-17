import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

const identity = ["-c", "user.name=Test Builder", "-c", "user.email=builder@example.com"];

const alwaysIgnored = [".agentbay/", ".forge/"];

type Files = Readonly<Record<string, string>>;

type Environment = Readonly<Record<string, string>>;

type GitRun = {
  readonly arguments: readonly string[];
  readonly input?: string;
  readonly environment?: Environment;
};

type Started = {
  readonly branch: string;
  readonly files: Files;
  readonly ignored: readonly string[];
};

export function gitWith(project: ModeProject, folder: string, run: GitRun): string {
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

export async function startedProject(
  modes: readonly string[],
  start: Started,
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
