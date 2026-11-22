import { isAbsolute, join, relative, sep } from "node:path";
import type { GrantedFoldersRequest, SkillAgent } from "../../bay/adapter.ts";
import type { DirectoryEntry, Problem } from "./adapter-types.ts";
import { searchBound } from "./guard-input.ts";
import { closedName } from "./guard-paths.ts";
import { isRealInside, isTrackedCopy, worktreeOf, type CopyFacts, type Worktree } from "./worktree-copies.ts";

type Scan =
  | { readonly kind: "clear" }
  | { readonly kind: "closed"; readonly path: string }
  | { readonly kind: "too-large" }
  | { readonly kind: "worktrees-too-large" };

const worktreesBound = { entries: 30_000 } as const;

type Region =
  | { readonly kind: "ordinary"; seen: number }
  | { readonly kind: "worktree"; readonly root: string; readonly worktree: Worktree; seen: number };

type Place = {
  readonly path: string;
  readonly depth: number;
  readonly region: Region;
  readonly throughLink: boolean;
};

type Walk = { readonly queue: Place[]; worktreeEntries: number };

type Found = { readonly place: Place; readonly path: string; readonly entry: DirectoryEntry };

async function placeOf(
  request: GrantedFoldersRequest,
  place: Place,
  entries: readonly DirectoryEntry[],
): Promise<Place> {
  if (place.region.kind === "worktree") {
    return place;
  }
  const worktree = await worktreeOf(request, place.path, entries);
  if (worktree === undefined) {
    return place;
  }
  return {
    path: place.path,
    depth: 0,
    region: { kind: "worktree", root: place.path, worktree, seen: 0 },
    throughLink: false,
  };
}

function hasClosedSegment(below: string): boolean {
  return below.split(sep).some((segment) => closedName(segment) !== undefined);
}

function isClosed(region: Region, entry: DirectoryEntry, facts: CopyFacts | undefined): boolean {
  if (region.kind === "ordinary") {
    return closedName(entry.name) !== undefined;
  }
  return facts !== undefined && !isTrackedCopy(facts, region.worktree.tracked);
}

async function factsFor(request: GrantedFoldersRequest, found: Found): Promise<CopyFacts | undefined> {
  const { region, throughLink } = found.place;
  if (region.kind === "ordinary") {
    return undefined;
  }
  const below = relative(region.root, found.path);
  if (below === ".git" || !hasClosedSegment(below)) {
    return undefined;
  }
  const realInside = await isRealInside(request, found.path, region.worktree.realRoot);
  return { below, kind: found.entry.kind, throughLink, realInside };
}

function ownClosedSegment(folder: string, bases: readonly string[]): boolean {
  return bases.some((base) => {
    const below = relative(base, folder);
    return !below.startsWith("..") && below.split(sep).some((segment) => closedName(segment) !== undefined);
  });
}

function overBound(walk: Walk, region: Region): Scan | undefined {
  if (region.seen > searchBound.entries) {
    return { kind: "too-large" };
  }
  return walk.worktreeEntries > worktreesBound.entries ? { kind: "worktrees-too-large" } : undefined;
}

async function entryScan(request: GrantedFoldersRequest, walk: Walk, found: Found): Promise<Scan | undefined> {
  const { place, path, entry } = found;
  const { region } = place;
  region.seen += 1;
  walk.worktreeEntries += region.kind === "worktree" ? 1 : 0;
  if (isClosed(region, entry, await factsFor(request, found))) {
    return { kind: "closed", path };
  }
  const over = overBound(walk, region);
  if (over !== undefined || (entry.kind !== "directory" && entry.kind !== "link")) {
    return over;
  }
  const depth = place.depth + 1;
  if (depth > searchBound.depth && (await request.inspector.entries(path)).length > 0) {
    return { kind: "too-large" };
  }
  walk.queue.push({ path, depth, region, throughLink: place.throughLink || entry.kind === "link" });
  return undefined;
}

async function scanFolder(request: GrantedFoldersRequest, folder: string): Promise<Scan> {
  const start: Place = { path: folder, depth: 0, region: { kind: "ordinary", seen: 0 }, throughLink: false };
  const walk: Walk = { queue: [start], worktreeEntries: 0 };
  for (const next of walk.queue) {
    const entries = await request.inspector.entries(next.path);
    const place = await placeOf(request, next, entries);
    for (const entry of entries) {
      const scan = await entryScan(request, walk, { place, path: join(place.path, entry.name), entry });
      if (scan !== undefined) {
        return scan;
      }
    }
  }
  return { kind: "clear" };
}

type Scans = Map<string, Promise<Scan>>;

function scanOnce(request: GrantedFoldersRequest, scans: Scans, folder: string): Promise<Scan> {
  const known = scans.get(folder) ?? scanFolder(request, folder);
  scans.set(folder, known);
  return known;
}

async function rootProblem(
  request: GrantedFoldersRequest,
  agent: SkillAgent,
  granted: { readonly folder: string; readonly scans: Scans },
): Promise<Problem | undefined> {
  const { folder } = granted;
  const where = { file: agent.skillFile, path: "" };
  if (ownClosedSegment(folder, [request.layout.project, request.layout.kit])) {
    return { ...where, message: `the step ${agent.agent} is granted ${folder}, whose path names a closed location` };
  }
  const scan = await scanOnce(request, granted.scans, folder);
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
    case "worktrees-too-large":
      return {
        ...where,
        message:
          `the step ${agent.agent} is granted ${folder}, whose worktrees of this project hold more than ` +
          `${String(worktreesBound.entries)} entries together, more than the build checks`,
        fix: "remove the worktrees an earlier run left, or grant the mode a narrower folder",
      };
  }
}

export async function grantedRootProblems(request: GrantedFoldersRequest): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  const scans: Scans = new Map();
  for (const agent of request.agents) {
    const roots = new Set([...agent.grants.readPaths, ...agent.grants.writePaths]);
    for (const folder of roots) {
      const absolute = isAbsolute(folder) ? folder : join(request.layout.project, folder);
      const problem = await rootProblem(request, agent, { folder: absolute, scans });
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
  }
  return problems;
}
