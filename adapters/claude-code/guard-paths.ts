import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { alwaysDeniedNames, kitFolders, searchBound } from "./guard-input.ts";

export type PathState =
  | { readonly kind: "exists"; readonly realPath: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unresolvable" };

export type FolderEntry = { readonly name: string; readonly kind: "folder" | "link" | "other" };

export type PathFacts = {
  readonly inspect: (path: string) => PathState;
  readonly entries: (folder: string) => readonly FolderEntry[] | undefined;
};

export type Places = {
  readonly project: string;
  readonly kit: string;
};

export type Target =
  | { readonly kind: "resolved"; readonly written: string; readonly real: string }
  | { readonly kind: "refused"; readonly why: string };

function realPathOf(path: string, facts: PathFacts, missing: readonly string[] = []): string | undefined {
  const state = facts.inspect(path);
  switch (state.kind) {
    case "exists":
      return join(state.realPath, ...missing);
    case "unresolvable":
      return undefined;
    case "missing": {
      const parent = dirname(path);
      return parent === path ? undefined : realPathOf(parent, facts, [basename(path), ...missing]);
    }
  }
}

export function resolveTarget(raw: string, base: string, facts: PathFacts): Target {
  if (raw === "" || raw.includes("\0")) {
    return { kind: "refused", why: "the path is empty or holds a NUL character" };
  }
  if (raw.split(/[\\/]/).includes("..")) {
    return { kind: "refused", why: "the path climbs with '..'" };
  }
  if (raw.startsWith("~")) {
    return { kind: "refused", why: "the path starts with '~', which may name a home folder" };
  }
  if (!isAbsolute(raw) && !isAbsolute(base)) {
    return { kind: "refused", why: "the path is relative and the call has no absolute working folder" };
  }
  const written = isAbsolute(raw) ? normalize(raw) : resolve(base, raw);
  const real = realPathOf(written, facts);
  if (real === undefined) {
    return { kind: "refused", why: "the path cannot be resolved (a broken link or an unreadable folder)" };
  }
  return { kind: "resolved", written, real };
}

function withoutTrailingSeparator(path: string): string {
  return path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path;
}

function isInside(child: string, parent: string): boolean {
  const folder = withoutTrailingSeparator(parent);
  if (folder === sep) {
    return child.startsWith(sep);
  }
  return child === folder || child.startsWith(`${folder}${sep}`);
}

export function isInsideIgnoringCase(child: string, parent: string): boolean {
  return isInside(child.toLowerCase(), parent.toLowerCase());
}

export function realRoots(roots: readonly string[], facts: PathFacts): readonly string[] {
  return roots.flatMap((root) => {
    const real = realPathOf(normalize(root), facts);
    return real === undefined ? [] : [real];
  });
}

export function insideAnyRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isInside(path, root));
}

function matchesName(segment: string, name: string): boolean {
  const folded = segment.toLowerCase();
  const pattern = name.toLowerCase();
  return pattern.endsWith("*") ? folded.startsWith(pattern.slice(0, -1)) : folded === pattern;
}

export function closedName(segment: string): string | undefined {
  return alwaysDeniedNames.find((name) => matchesName(segment, name));
}

function bothForms(path: string, facts: PathFacts): readonly string[] {
  return [path, ...realRoots([path], facts)];
}

function segmentsBelowBase(path: string, bases: readonly string[]): readonly string[] {
  const containing = bases.filter((base) => isInside(path, base)).sort((left, right) => right.length - left.length);
  const base = containing[0];
  const below = base === undefined ? path : relative(base, path);
  return below.split(sep).filter((segment) => segment !== "");
}

export function closedNameIn(paths: readonly string[], places: Places, facts: PathFacts): string | undefined {
  const bases = [...bothForms(places.project, facts), ...bothForms(places.kit, facts)];
  for (const path of paths) {
    const name = segmentsBelowBase(path, bases)
      .map(closedName)
      .find((found) => found !== undefined);
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}

export function kitFoldersOf(places: Places, facts: PathFacts): readonly string[] {
  return bothForms(places.kit, facts).flatMap((kit) => kitFolders.map((folder) => join(kit, folder)));
}

function stepClosedKitFolders(places: Places, facts: PathFacts): readonly string[] {
  const kits = bothForms(places.kit, facts);
  const projects = bothForms(places.project, facts);
  const isProjectTheKit = kits.some((kit) => projects.includes(kit));
  return isProjectTheKit ? kitFoldersOf(places, facts) : [...kitFoldersOf(places, facts), ...kits];
}

export function kitFolderHolding(paths: readonly string[], places: Places, facts: PathFacts): string | undefined {
  const folders = stepClosedKitFolders(places, facts);
  return folders.find((folder) => paths.some((path) => isInsideIgnoringCase(path, folder)));
}

export type WalkFinding =
  | { readonly kind: "clear" }
  | { readonly kind: "closed"; readonly path: string }
  | { readonly kind: "link"; readonly path: string }
  | { readonly kind: "unlistable"; readonly path: string }
  | { readonly kind: "too-large" };

type Walk = {
  readonly facts: PathFacts;
  readonly linkAllowed: (path: string) => boolean;
  readonly queue: { readonly path: string; readonly depth: number }[];
  seen: number;
};

function entryFinding(walk: Walk, path: string, entry: FolderEntry): WalkFinding | undefined {
  if (closedName(entry.name) !== undefined) {
    return { kind: "closed", path };
  }
  if (entry.kind === "link" && !walk.linkAllowed(path)) {
    return { kind: "link", path };
  }
  return undefined;
}

function folderFinding(walk: Walk, folder: string, depth: number): WalkFinding | undefined {
  const entries = walk.facts.entries(folder);
  if (entries === undefined) {
    return { kind: "unlistable", path: folder };
  }
  for (const entry of entries) {
    walk.seen += 1;
    const path = join(folder, entry.name);
    const finding = walk.seen > searchBound.entries ? { kind: "too-large" as const } : entryFinding(walk, path, entry);
    if (finding !== undefined) {
      return finding;
    }
    if (entry.kind === "folder" && depth >= searchBound.depth) {
      return { kind: "too-large" };
    }
    if (entry.kind === "folder") {
      walk.queue.push({ path, depth: depth + 1 });
    }
  }
  return undefined;
}

export function walkSearchFolder(
  folder: string,
  facts: PathFacts,
  linkAllowed: (path: string) => boolean,
): WalkFinding {
  const walk: Walk = { facts, linkAllowed, queue: [{ path: folder, depth: 0 }], seen: 0 };
  for (let index = 0; index < walk.queue.length; index += 1) {
    const next = walk.queue[index];
    const finding = next === undefined ? undefined : folderFinding(walk, next.path, next.depth);
    if (finding !== undefined) {
      return finding;
    }
  }
  return { kind: "clear" };
}
