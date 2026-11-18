import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import type { Request } from "./request.ts";
import { inCopy, type Copy, type ProofStep } from "./step.ts";

export type ChangedPath =
  | { readonly how: "added" | "modified" | "deleted"; readonly path: string }
  | { readonly how: "renamed"; readonly path: string; readonly from: string };

export type Size = { readonly path: string; readonly base?: number; readonly head?: number };

type Lines = ReadonlyMap<string, number>;

const countSeconds = 60;

function textOf(value: Json, name: string): string {
  const field = fieldsOf(value)[name];
  return typeof field === "string" ? field : "";
}

function changedPathOf(value: Json): ChangedPath {
  const how = textOf(value, "how");
  const path = textOf(value, "path");
  if (how === "renamed") {
    return { how, path, from: textOf(value, "from") };
  }
  return { how: how === "added" || how === "deleted" ? how : "modified", path };
}

export function basePathOf(changed: ChangedPath): string | undefined {
  switch (changed.how) {
    case "added":
      return undefined;
    case "renamed":
      return changed.from;
    case "modified":
    case "deleted":
      return changed.path;
  }
}

export function headPathOf(changed: ChangedPath): string | undefined {
  return changed.how === "deleted" ? undefined : changed.path;
}

export function linesOf(stdout: string, paths: readonly string[]): Lines {
  const counts = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const found = /^\s*(\d+) (.+)$/.exec(line);
    const path = found?.[2];
    if (found !== null && path !== undefined && paths.includes(path)) {
      counts.set(path, Number.parseInt(found[1] ?? "", 10));
    }
  }
  return counts;
}

export function sizeOf(
  changed: readonly ChangedPath[],
  lines: { readonly base: Lines; readonly head: Lines },
): readonly Size[] {
  return changed.map((entry) => {
    const basePath = basePathOf(entry);
    const headPath = headPathOf(entry);
    const base = basePath === undefined ? undefined : lines.base.get(basePath);
    const head = headPath === undefined ? undefined : lines.head.get(headPath);
    return { path: entry.path, ...(base === undefined ? {} : { base }), ...(head === undefined ? {} : { head }) };
  });
}

async function countedLines(step: ProofStep, copy: Copy, paths: readonly string[]): Promise<Lines> {
  if (!copy.made || paths.length === 0) {
    return new Map();
  }
  const answer = await step.context.commands.run({
    name: "count-lines",
    arguments: paths,
    folder: copy.folder,
    timeLimitSeconds: countSeconds,
  });
  return answer.ok && answer.value.end.how === "exited" ? linesOf(answer.value.stdout.text, paths) : new Map();
}

async function linesAt(step: ProofStep, commit: string, paths: readonly string[]): Promise<Lines> {
  if (paths.length === 0) {
    return new Map();
  }
  return inCopy(step, commit, (copy) => countedLines(step, copy, paths));
}

export async function changedPaths(step: ProofStep, request: Request): Promise<readonly ChangedPath[] | undefined> {
  const answer = await step.called("worktrees.changed", { from: request.base, to: request.head });
  if (!answer.ok) {
    return undefined;
  }
  const paths = fieldsOf(answer.value).paths;
  return Array.isArray(paths) ? paths.map(changedPathOf) : [];
}

export async function sizeOfTheChange(step: ProofStep, request: Request): Promise<readonly Size[]> {
  const changed = await changedPaths(step, request);
  if (changed === undefined) {
    return [];
  }
  const base = await linesAt(
    step,
    request.base,
    changed.flatMap((entry) => basePathOf(entry) ?? []),
  );
  const head = await linesAt(
    step,
    request.head,
    changed.flatMap((entry) => headPathOf(entry) ?? []),
  );
  return sizeOf(changed, { base, head });
}
