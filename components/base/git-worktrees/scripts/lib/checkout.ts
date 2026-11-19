import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { differencesBetween } from "./differences.ts";
import { gitSucceeded, nulFields } from "./git.ts";

const namedAtMost = 5;

const branchPrefix = "refs/heads/";

function shown(commit: string): string {
  return commit.slice(0, 12);
}

function listed(paths: readonly string[]): string {
  const named = paths.slice(0, namedAtMost).join(", ");
  const more = paths.length - namedAtMost;
  return more > 0 ? `${named} and ${String(more)} more` : named;
}

export type Where = {
  readonly into: string;
  readonly start: string;
  readonly checkedOut: string | undefined;
  readonly head: string;
};

function branchNamed(checkedOut: string | undefined): string {
  return checkedOut?.startsWith(branchPrefix) === true ? checkedOut.slice(branchPrefix.length) : "a detached head";
}

export function movedSentence(where: Where): readonly string[] {
  const { into, start, checkedOut, head } = where;
  if (checkedOut !== `${branchPrefix}${into}`) {
    return [
      `The project's folder switched from ${into} to ${branchNamed(checkedOut)} while the merge was made, so ${into} ` +
        `was not fast-forwarded and nothing changed. Switch back to ${into}, then merge again.`,
    ];
  }
  if (head !== start) {
    return [
      `The branch ${into} moved from ${shown(start)} to ${shown(head)} while the merge was made, so it was not ` +
        "fast-forwarded and nothing changed. Merge again to merge into where it is now.",
    ];
  }
  return [];
}

export type FolderState = {
  readonly into: string;
  readonly changed: readonly string[];
  readonly blocked: readonly string[];
};

function remedyFor(state: FolderState): string {
  if (state.changed.length === 0) {
    return "Move them away, then merge again.";
  }
  if (state.blocked.length === 0) {
    return "Commit them or set them aside, then merge again.";
  }
  return "Commit them or set them aside, move the others away, then merge again.";
}

export function folderChangedSentences(state: FolderState): readonly string[] {
  const { into, changed, blocked } = state;
  const found = [
    ...(changed.length === 0 ? [] : [`uncommitted changes to ${listed(changed)}`]),
    ...(blocked.length === 0 ? [] : [`untracked or ignored files where the merge puts its own: ${listed(blocked)}`]),
  ];
  if (found.length === 0) {
    return [];
  }
  return [
    `The project's folder has ${found.join(", and ")}, so ${into} was not fast-forwarded and nothing changed. ` +
      remedyFor(state),
  ];
}

function withFoldersAbove(path: string): readonly string[] {
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function blocks(entry: string, added: readonly string[]): boolean {
  if (entry.endsWith("/")) {
    return added.includes(entry.slice(0, -1));
  }
  return added.some((path) => path === entry || path.startsWith(`${entry}/`));
}

export async function blockedPaths(
  context: ScriptContext,
  commits: { readonly from: string; readonly to: string },
): Promise<readonly string[]> {
  const added = (await differencesBetween(context, commits))
    .filter((difference) => difference.how === "added" || difference.how === "renamed")
    .map((difference) => difference.path);
  if (added.length === 0) {
    return [];
  }
  const asked = [...new Set(added.flatMap(withFoldersAbove))];
  const present = nulFields(await gitSucceeded(context, ".", ["untracked-paths", ...asked]));
  return present.filter((entry) => blocks(entry, added));
}
