import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export type PathState =
  | { readonly kind: "exists"; readonly realPath: string }
  | { readonly kind: "missing" }
  | { readonly kind: "unresolvable" };

export type PathFacts = {
  readonly inspect: (path: string) => PathState;
};

export type Places = {
  readonly root: string;
  readonly kit: string;
  readonly deniedNames: readonly string[];
  readonly deniedKitFolders: readonly string[];
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

export function matchesName(segment: string, name: string): boolean {
  const folded = segment.toLowerCase();
  const pattern = name.toLowerCase();
  return pattern.endsWith("*") ? folded.startsWith(pattern.slice(0, -1)) : folded === pattern;
}

function segmentsBelowBase(path: string, bases: readonly string[]): readonly string[] {
  const containing = bases.filter((base) => isInside(path, base)).sort((left, right) => right.length - left.length);
  const base = containing[0];
  const below = base === undefined ? path : relative(base, path);
  return below.split(sep).filter((segment) => segment !== "");
}

function deniedNameIn(path: string, places: Places, bases: readonly string[]): string | undefined {
  const segments = segmentsBelowBase(path, bases);
  return places.deniedNames.find((name) => segments.some((segment) => matchesName(segment, name)));
}

function deniedKitFolderIn(path: string, places: Places, kits: readonly string[]): string | undefined {
  return places.deniedKitFolders.find((folder) => kits.some((kit) => isInsideIgnoringCase(path, join(kit, folder))));
}

export function protectedPart(paths: readonly string[], places: Places, facts: PathFacts): string | undefined {
  const roots = [places.root, ...realRoots([places.root], facts)];
  const kits = [places.kit, ...realRoots([places.kit], facts)];
  for (const path of paths) {
    const folder = deniedKitFolderIn(path, places, kits);
    if (folder !== undefined) {
      return `the kit's ${folder}/ folder`;
    }
    const name = deniedNameIn(path, places, [...roots, ...kits]);
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}

export function protectedLocations(places: Places, facts: PathFacts): readonly string[] {
  const exactNames = places.deniedNames.filter((name) => !name.endsWith("*"));
  const roots = [places.root, ...realRoots([places.root], facts)];
  const kits = [places.kit, ...realRoots([places.kit], facts)];
  return [
    ...[...roots, ...kits].flatMap((base) => exactNames.map((name) => join(base, name))),
    ...kits.flatMap((kit) => places.deniedKitFolders.map((folder) => join(kit, folder))),
  ];
}
