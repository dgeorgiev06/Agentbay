import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

export type Files = Readonly<Record<string, string>>;

const identity = ["-c", "user.name=Test Builder", "-c", "user.email=builder@example.com"];

export function git(project: ModeProject, folder: string, gitArguments: readonly string[]): string {
  return execFileSync("git", [...identity, ...gitArguments], { cwd: join(project.root, folder) }).toString("utf8");
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

export async function openRepositoryProject(
  modes: readonly string[] = ["git-worktrees"],
): Promise<ModeProject & { readonly base: string }> {
  const project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: [...modes] });
  git(project, ".", ["symbolic-ref", "HEAD", "refs/heads/main"]);
  const base = await commitFiles(project, {
    files: { ".gitignore": ".agentbay/\n.forge/\n", "README.md": "A small repository.\n" },
    message: "Start the repository",
  });
  return { ...project, base };
}

export function refsAndWorktrees(project: ModeProject): string {
  const refs = git(project, ".", ["for-each-ref", "--format=%(refname) %(objectname)"]);
  return `${refs}${git(project, ".", ["worktree", "list", "--porcelain"])}`;
}
