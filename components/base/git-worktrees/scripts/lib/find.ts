import { isMadeBranch, notMadeSentence } from "./drop.ts";

export type FindAnswer =
  | { readonly how: "found"; readonly branch: string; readonly commit: string }
  | { readonly how: "not-there"; readonly branch: string }
  | { readonly how: "refused"; readonly branch: string; readonly reason: string };

export function refusedToFind(branch: string): FindAnswer | undefined {
  return isMadeBranch(branch)
    ? undefined
    : { how: "refused", branch, reason: notMadeSentence(branch, "the mode does not look at it") };
}

export function foundAt(branch: string, commit: string | undefined): FindAnswer {
  return commit === undefined ? { how: "not-there", branch } : { how: "found", branch, commit };
}
