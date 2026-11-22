import { isAbsolute, join, relative, sep } from "node:path";
import type { GrantedFoldersRequest, SkillAgent } from "../../bay/adapter.ts";
import type { DirectoryEntry, Problem } from "./adapter-types.ts";
import { searchBound } from "./guard-input.ts";
import { closedName } from "./guard-paths.ts";
import { isTrackedCopy, trackedIn, worktreeGitDir, type Tracked } from "./worktree-copies.ts";

type Scan =
  { readonly kind: "clear" } | { readonly kind: "closed"; readonly path: string } | { readonly kind: "too-large" };

type Worktree = {
  readonly kind: "worktree";
  readonly root: string;
  readonly gitDir: string;
  seen: number;
  tracked: Tracked | undefined | "unasked";
};

type Region = { readonly kind: "ordinary"; seen: number } | Worktree;

type Place = { readonly path: string; readonly depth: number; readonly region: Region };

async function placeOf(
  request: GrantedFoldersRequest,
  place: Place,
  entries: readonly DirectoryEntry[],
): Promise<Place> {
  if (place.region.kind === "worktree") {
    return place;
  }
  const gitDir = await worktreeGitDir(request, place.path, entries);
  if (gitDir === undefined) {
    return place;
  }
  const worktree: Worktree = { kind: "worktree", root: place.path, gitDir, seen: 0, tracked: "unasked" };
  return { path: place.path, depth: 0, region: worktree };
}

async function trackedOfWorktree(request: GrantedFoldersRequest, worktree: Worktree): Promise<Tracked | undefined> {
  if (worktree.tracked === "unasked") {
    worktree.tracked = await trackedIn(request, worktree);
  }
  return worktree.tracked;
}

type Found = { readonly path: string; readonly entry: DirectoryEntry };

async function isClosedEntry(request: GrantedFoldersRequest, region: Region, found: Found): Promise<boolean> {
  const { path, entry } = found;
  if (region.kind === "ordinary") {
    return closedName(entry.name) !== undefined;
  }
  const below = relative(region.root, path);
  if (below === ".git" || !below.split(sep).some((segment) => closedName(segment) !== undefined)) {
    return false;
  }
  const tracked = await trackedOfWorktree(request, region);
  return tracked === undefined || !isTrackedCopy(below, entry, tracked);
}

function ownClosedSegment(folder: string, bases: readonly string[]): boolean {
  return bases.some((base) => {
    const below = relative(base, folder);
    return !below.startsWith("..") && below.split(sep).some((segment) => closedName(segment) !== undefined);
  });
}

async function scanFolder(request: GrantedFoldersRequest, folder: string): Promise<Scan> {
  const { inspector } = request;
  const queue: Place[] = [{ path: folder, depth: 0, region: { kind: "ordinary", seen: 0 } }];
  for (const next of queue) {
    const entries = await inspector.entries(next.path);
    const { path: parent, depth, region } = await placeOf(request, next, entries);
    for (const entry of entries) {
      region.seen += 1;
      const path = join(parent, entry.name);
      if (await isClosedEntry(request, region, { path, entry })) {
        return { kind: "closed", path };
      }
      const below = depth + 1;
      if (
        region.seen > searchBound.entries ||
        (below > searchBound.depth && (await inspector.entries(path)).length > 0)
      ) {
        return { kind: "too-large" };
      }
      queue.push({ path, depth: below, region });
    }
  }
  return { kind: "clear" };
}

async function rootProblem(
  request: GrantedFoldersRequest,
  agent: SkillAgent,
  folder: string,
): Promise<Problem | undefined> {
  const where = { file: agent.skillFile, path: "" };
  if (ownClosedSegment(folder, [request.layout.project, request.layout.kit])) {
    return { ...where, message: `the step ${agent.agent} is granted ${folder}, whose path names a closed location` };
  }
  const scan = await scanFolder(request, folder);
  switch (scan.kind) {
    case "clear":
      return undefined;
    case "closed":
      return {
        ...where,
        message: `the step ${agent.agent} is granted ${folder}, which holds ${scan.path}`,
        fix: "grant the mode a narrower folder: a folder that holds secrets or agentbay's own files is closed to steps",
      };
    case "too-large":
      return {
        ...where,
        message:
          `the step ${agent.agent} is granted ${folder}, which holds more than ${String(searchBound.entries)} ` +
          `entries or is deeper than ${String(searchBound.depth)} levels, more than the build checks`,
        fix: "grant the mode a narrower folder",
      };
  }
}

export async function grantedRootProblems(request: GrantedFoldersRequest): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const agent of request.agents) {
    const roots = new Set([...agent.grants.readPaths, ...agent.grants.writePaths]);
    for (const folder of roots) {
      const absolute = isAbsolute(folder) ? folder : join(request.layout.project, folder);
      const problem = await rootProblem(request, agent, absolute);
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
  }
  return problems;
}
