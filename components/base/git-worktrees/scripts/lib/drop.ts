export type BranchFacts = {
  readonly branch: string;
  readonly into: string | undefined;
  readonly commit: string | undefined;
  readonly checkedOut: string | undefined;
  readonly liveWorktree: string | undefined;
};

export type DropVerdict =
  | { readonly how: "drop"; readonly commit: string }
  | { readonly how: "not-there"; readonly branch: string }
  | { readonly how: "refused"; readonly branch: string; readonly commit?: string; readonly reason: string };

export type Leftover = {
  readonly slice: string;
  readonly branch: string;
  readonly commit: string;
};

const sliceName = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

const wipNumber = /^[1-9][0-9]*$/;

const branchRef = "refs/heads/";

function isSliceBranch(parts: readonly string[]): boolean {
  const [slice = ""] = parts;
  return parts.length === 1 && slice !== "wip" && sliceName.test(slice);
}

function isWipBranch(parts: readonly string[]): boolean {
  const [wip, slice = "", number = ""] = parts;
  return parts.length === 3 && wip === "wip" && sliceName.test(slice) && wipNumber.test(number);
}

export function isMadeBranch(branch: string): boolean {
  const [prefix, ...parts] = branch.split("/");
  return prefix === "forge" && (isSliceBranch(parts) || isWipBranch(parts));
}

function shortName(name: string): string {
  return name.startsWith(branchRef) ? name.slice(branchRef.length) : name;
}

function namedReason(facts: BranchFacts): string | undefined {
  const { branch, into } = facts;
  if (!isMadeBranch(branch)) {
    return `The branch ${branch} is not one this mode makes, forge/<slice> or forge/wip/<slice>/<n>, so it is kept.`;
  }
  if (into !== undefined && shortName(into) === branch) {
    return `The branch ${branch} is the branch work is merged into, named as into, so it is kept.`;
  }
  return undefined;
}

function heldReason(facts: BranchFacts): string | undefined {
  const { branch, checkedOut, liveWorktree } = facts;
  if (checkedOut !== undefined && shortName(checkedOut) === branch) {
    return (
      `The project's own folder has the branch ${branch} checked out, so it is kept. ` +
      "Switch the folder to another branch, then drop it again."
    );
  }
  if (liveWorktree !== undefined) {
    return (
      `The worktree ${liveWorktree} of this mode still has the branch ${branch}, so it is kept. ` +
      "Remove the worktree first, with branchAfter kept, then drop the branch again."
    );
  }
  return undefined;
}

function refused(facts: BranchFacts, reason: string): DropVerdict {
  const { branch, commit } = facts;
  return commit === undefined ? { how: "refused", branch, reason } : { how: "refused", branch, commit, reason };
}

export function dropVerdict(facts: BranchFacts): DropVerdict {
  const named = namedReason(facts);
  if (named !== undefined) {
    return refused(facts, named);
  }
  if (facts.commit === undefined) {
    return { how: "not-there", branch: facts.branch };
  }
  const held = heldReason(facts);
  return held === undefined ? { how: "drop", commit: facts.commit } : refused(facts, held);
}

export function leftoverSentence(leftover: Leftover): string {
  const { slice, branch, commit } = leftover;
  return (
    `The branch ${branch} already exists at the commit ${commit}, so the slice ${slice} is not cut again. ` +
    "Drop the branch with drop-branch, which answers that commit so its work can be found again, or cut the " +
    "slice under another name."
  );
}
