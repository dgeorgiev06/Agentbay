import type { Request } from "../lib/request.ts";
import { changedPaths, type ChangedPath } from "../lib/size.ts";
import type { ProofStep } from "../lib/step.ts";

export type Changed = { readonly known: false } | { readonly known: true; readonly paths: readonly ChangedPath[] };

export const changedNotKnown =
  "What changed between the base and the head is not known: the worktrees interface did not answer.";

export function touchedPaths(paths: readonly ChangedPath[]): readonly string[] {
  const touched = paths.flatMap((changed) =>
    changed.how === "renamed" ? [changed.from, changed.path] : [changed.path],
  );
  return [...new Set(touched)];
}

export async function changedBetween(step: ProofStep, request: Request): Promise<Changed> {
  const paths = await changedPaths(step, request);
  return paths === undefined ? { known: false } : { known: true, paths };
}
