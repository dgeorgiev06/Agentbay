import { dirname, join, normalize, sep } from "node:path";
import type { GrantedFoldersRequest } from "../../bay/adapter.ts";
import type { DirectoryEntry } from "./adapter-types.ts";
import { closedName } from "./guard-paths.ts";

export type Tracked = {
  readonly files: ReadonlySet<string>;
  readonly folders: ReadonlySet<string>;
};

const worktreePointer = /^gitdir: ([^\r\n]+)\n?$/;

const indexRecord = /^([0-7]{6}) [0-9a-f]{40}(?:[0-9a-f]{24})? ([0-3])\t(.+)$/s;

const regularFileModes: readonly string[] = ["100644", "100755"];

const sharedTemplate = /\.(example|sample|template)$/i;

const gitSecondsAllowed = 30;

function pointedGitDir(text: string | undefined, worktrees: string): string | undefined {
  const target = text === undefined ? undefined : worktreePointer.exec(text)?.[1];
  const accepted = target !== undefined && normalize(target) === target && dirname(target) === worktrees;
  return accepted ? target : undefined;
}

async function realWorktreesFolder(request: GrantedFoldersRequest): Promise<string> {
  const { project } = request.layout;
  return join((await request.inspector.realPath(project)) ?? project, ".git", "worktrees");
}

export async function worktreeGitDir(
  request: GrantedFoldersRequest,
  folder: string,
  entries: readonly DirectoryEntry[],
): Promise<string | undefined> {
  const pointer = entries.find((entry) => entry.name === ".git");
  if (pointer?.kind !== "file") {
    return undefined;
  }
  return pointedGitDir(await request.files.readText(join(folder, ".git")), await realWorktreesFolder(request));
}

function foldersAbove(path: string): readonly string[] {
  const segments = path.split("/");
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function trackedOf(output: string): Tracked | undefined {
  const records = output.split("\0");
  if (records.pop() !== "") {
    return undefined;
  }
  const files = new Set<string>();
  for (const record of records) {
    const match = indexRecord.exec(record);
    if (match === null) {
      return undefined;
    }
    const [, mode = "", stage = "", path = ""] = match;
    if (stage === "0" && regularFileModes.includes(mode)) {
      files.add(path);
    }
  }
  return { files, folders: new Set([...files].flatMap(foldersAbove)) };
}

function isNeverACopy(segment: string): boolean {
  const name = closedName(segment);
  const secret = (name === ".env" || name === ".env.*") && !sharedTemplate.test(segment);
  return name === ".git" || secret;
}

export function isTrackedCopy(below: string, entry: DirectoryEntry, tracked: Tracked): boolean {
  if (below.split(sep).some(isNeverACopy)) {
    return false;
  }
  switch (entry.kind) {
    case "file":
      return tracked.files.has(below);
    case "directory":
      return tracked.folders.has(below);
    case "link":
    case "other":
      return false;
  }
}

export async function trackedIn(
  request: GrantedFoldersRequest,
  worktree: { readonly root: string; readonly gitDir: string },
): Promise<Tracked | undefined> {
  const result = await request.processes.run({
    command: "git",
    arguments: [
      `--git-dir=${worktree.gitDir}`,
      `--work-tree=${worktree.root}`,
      "-c",
      "core.fsmonitor=false",
      "--no-optional-locks",
      "ls-files",
      "--stage",
      "-z",
    ],
    directory: worktree.root,
    environment: { PATH: request.searchPath, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    timeoutMilliseconds: gitSecondsAllowed * 1000,
  });
  const { end, stdout } = result;
  const whole = end.how === "exited" && end.exitCode === 0 && stdout.characters === stdout.text.length;
  return whole ? trackedOf(stdout.text) : undefined;
}
