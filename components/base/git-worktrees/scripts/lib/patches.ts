import { fail } from "../../../../../bay/sdk.ts";

type Hunk = { readonly old: number; readonly new: number };

const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

const acceptedPath = /^\.?[A-Za-z0-9_][A-Za-z0-9_.-]*(\/\.?[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

function refused(path: string, which: string): never {
  return fail(`The patch names the path ${path}, which ${which}, so nothing is applied.`);
}

function refuseOutside(path: string): void {
  if (path.startsWith("/")) {
    refused(path, "is absolute");
  }
  if (path.includes("..")) {
    refused(path, "has ..");
  }
}

function checkedPath(path: string): string {
  refuseOutside(path);
  if (!acceptedPath.test(path)) {
    return refused(path, "is not letters, digits, dots, dashes and underscores in folders");
  }
  return path;
}

function withoutPrefix(named: string): string {
  if (named.startsWith("/")) {
    return refused(named, "is absolute");
  }
  const slash = named.indexOf("/");
  const path = checkedPath(slash < 0 ? named : named.slice(slash + 1));
  refuseOutside(named);
  return path;
}

function gitHeaderPaths(line: string): readonly string[] {
  const words = line.split(" ");
  const [, , from, to] = words;
  if (words.length !== 4 || from === undefined || to === undefined) {
    return fail(`The patch has a line the mode cannot read: ${line}`);
  }
  return [withoutPrefix(from), withoutPrefix(to)];
}

function fileLinePath(line: string): readonly string[] {
  const named = line.slice(4).split("\t")[0] ?? "";
  return named === "/dev/null" ? [] : [withoutPrefix(named)];
}

function headerPaths(line: string): readonly string[] {
  if (line.startsWith("diff --git ")) {
    return gitHeaderPaths(line);
  }
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return fileLinePath(line);
  }
  const named = /^(?:rename|copy) (?:from|to) (.*)$/.exec(line);
  return named?.[1] === undefined ? [] : [checkedPath(named[1])];
}

function hunkOf(line: string): Hunk | undefined {
  const counts = hunkHeader.exec(line);
  if (counts === null) {
    return undefined;
  }
  const hunk = { old: Number(counts[1] ?? "1"), new: Number(counts[2] ?? "1") };
  return hunk.old > 0 || hunk.new > 0 ? hunk : undefined;
}

function rest(hunk: Hunk, line: string): Hunk | undefined {
  const mark = line.slice(0, 1);
  const left = {
    old: hunk.old - (mark === "+" || mark === "\\" ? 0 : 1),
    new: hunk.new - (mark === "-" || mark === "\\" ? 0 : 1),
  };
  return left.old > 0 || left.new > 0 ? left : undefined;
}

export function pathsOfPatch(patch: string): readonly string[] {
  const paths: string[] = [];
  let hunk: Hunk | undefined;
  for (const line of patch.split("\n")) {
    if (hunk !== undefined) {
      hunk = rest(hunk, line);
      continue;
    }
    hunk = hunkOf(line);
    for (const path of hunk === undefined ? headerPaths(line) : []) {
      if (!paths.includes(path)) {
        paths.push(path);
      }
    }
  }
  if (paths.length === 0) {
    return fail("The patch names no file, so there is nothing to apply.");
  }
  return paths;
}
