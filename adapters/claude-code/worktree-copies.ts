import { basename, dirname, join, normalize, sep } from "node:path";
import { gitReading, type GrantedFoldersRequest } from "../../bay/adapter.ts";
import type { DirectoryEntry } from "./adapter-types.ts";
import { closedName } from "./guard-paths.ts";

export type Tracked = {
  readonly files: ReadonlySet<string>;
  readonly folders: ReadonlySet<string>;
};

export type Worktree = {
  readonly realRoot: string;
  readonly tracked: Tracked | undefined;
};

export type CopyFacts = {
  readonly below: string;
  readonly kind: DirectoryEntry["kind"];
  readonly throughLink: boolean;
  readonly realInside: boolean;
};

const worktreePointer = /^gitdir: ([^\x00-\x1f\x7f]+)\n?$/;

const backLink = /^([^\x00-\x1f\x7f]+)\n?$/;

const indexRecord = /^([0-7]{6}) [0-9a-f]{40}(?:[0-9a-f]{24})? ([0-3])\t(.+)$/s;

const regularFileModes: readonly string[] = ["100644", "100755"];

const sharedTemplate = /\.(example|sample|template)$/i;

function plainPath(pattern: RegExp, text: string | undefined): string | undefined {
  const path = text === undefined ? undefined : pattern.exec(text)?.[1];
  return path !== undefined && normalize(path) === path ? path : undefined;
}

async function realWorktreesFolder(request: GrantedFoldersRequest): Promise<string> {
  const { project } = request.layout;
  return join((await request.inspector.realPath(project)) ?? project, ".git", "worktrees");
}

async function ownGitDir(request: GrantedFoldersRequest, folder: string): Promise<string | undefined> {
  const gitDir = plainPath(worktreePointer, await request.files.readText(join(folder, ".git")));
  if (gitDir === undefined || dirname(gitDir) !== (await realWorktreesFolder(request))) {
    return undefined;
  }
  return (await request.inspector.realPath(gitDir)) === gitDir ? gitDir : undefined;
}

async function pointsBack(request: GrantedFoldersRequest, gitDir: string, realFolder: string): Promise<boolean> {
  const recorded = plainPath(backLink, await request.files.readText(join(gitDir, "gitdir")));
  if (recorded === undefined || basename(recorded) !== ".git") {
    return false;
  }
  return (await request.inspector.realPath(dirname(recorded))) === realFolder;
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

async function trackedIn(
  request: GrantedFoldersRequest,
  gitDir: string,
  realRoot: string,
): Promise<Tracked | undefined> {
  const words = [`--git-dir=${gitDir}`, `--work-tree=${realRoot}`, "ls-files", "--stage", "-z"];
  const reading = gitReading(words, { directory: realRoot, searchPath: request.searchPath });
  const result = await request.processes.run(reading).catch(() => undefined);
  if (result === undefined) {
    return undefined;
  }
  const { end, stdout } = result;
  const whole = end.how === "exited" && end.exitCode === 0 && stdout.characters === stdout.text.length;
  return whole ? trackedOf(stdout.text) : undefined;
}

export async function worktreeOf(
  request: GrantedFoldersRequest,
  folder: string,
  entries: readonly DirectoryEntry[],
): Promise<Worktree | undefined> {
  if (entries.find((entry) => entry.name === ".git")?.kind !== "file") {
    return undefined;
  }
  const gitDir = await ownGitDir(request, folder);
  const realRoot = await request.inspector.realPath(folder);
  if (gitDir === undefined || realRoot === undefined || !(await pointsBack(request, gitDir, realRoot))) {
    return undefined;
  }
  return { realRoot, tracked: await trackedIn(request, gitDir, realRoot) };
}

export async function isRealInside(request: GrantedFoldersRequest, path: string, realRoot: string): Promise<boolean> {
  const real = await request.inspector.realPath(path);
  return real !== undefined && real.startsWith(`${realRoot}${sep}`);
}

function isNeverACopy(segment: string): boolean {
  const name = closedName(segment);
  const secret = (name === ".env" || name === ".env.*") && !sharedTemplate.test(segment);
  return name === ".git" || secret;
}

export function isTrackedCopy(facts: CopyFacts, tracked: Tracked | undefined): boolean {
  if (tracked === undefined || facts.throughLink || !facts.realInside || facts.below.split(sep).some(isNeverACopy)) {
    return false;
  }
  switch (facts.kind) {
    case "file":
      return tracked.files.has(facts.below);
    case "directory":
      return tracked.folders.has(facts.below);
    case "link":
    case "other":
      return false;
  }
}
