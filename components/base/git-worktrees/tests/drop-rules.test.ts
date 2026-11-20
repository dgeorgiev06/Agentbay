import assert from "node:assert/strict";
import { test } from "node:test";
import { dropVerdict, isMadeBranch, leftoverSentence, type BranchFacts } from "../scripts/lib/drop.ts";

const commit = "79fe81d1c4a6b0e2f3d5a7c9e1b3d5f7a9c1e3b5";

const facts: BranchFacts = {
  branch: "forge/mail-source-planter",
  into: "main",
  commit,
  checkedOut: "main",
  liveWorktree: undefined,
};

test("a branch the mode makes is forge/<slice> or forge/wip/<slice>/<n>, and nothing else", () => {
  const made = ["forge/a", "forge/mail-source-tests-1", "forge/wip/a/1", "forge/wip/mail-source/12"];
  const notMade = [
    "main",
    "forge",
    "forge/",
    "forge/wip",
    "forge/wip/a",
    "forge/wip/a/0",
    "forge/wip/a/01",
    "forge/wip/a/b",
    "forge/a/b",
    "forge/-a",
    "forge/a..b",
    "forge/a.lock",
    "forge/a@{1}",
    "refs/heads/forge/a",
    "other/forge/a",
    `forge/${"a".repeat(65)}`,
  ];
  assert.deepEqual(made.filter(isMadeBranch), made);
  assert.deepEqual(notMade.filter(isMadeBranch), []);
});

test("a branch the mode made with no worktree, not checked out and not named as into is dropped at its commit", () => {
  assert.deepEqual(dropVerdict(facts), { how: "drop", commit });
  assert.deepEqual(dropVerdict({ ...facts, into: undefined, checkedOut: undefined }), { how: "drop", commit });
});

test("a branch that does not exist is not there, and that is an answer", () => {
  assert.deepEqual(dropVerdict({ ...facts, commit: undefined }), {
    how: "not-there",
    branch: "forge/mail-source-planter",
  });
});

test("a branch the mode does not make is refused, whether it exists or not", () => {
  const reason =
    "The branch forge/wip is not one this mode makes, forge/<slice> or forge/wip/<slice>/<n>, so it is kept.";
  assert.deepEqual(dropVerdict({ ...facts, branch: "forge/wip" }), {
    how: "refused",
    branch: "forge/wip",
    commit,
    reason,
  });
  assert.deepEqual(dropVerdict({ ...facts, branch: "forge/wip", commit: undefined }), {
    how: "refused",
    branch: "forge/wip",
    reason,
  });
});

test("the branch named as into is refused, also when into names it as a ref", () => {
  const branch = "forge/integration";
  const refused = {
    how: "refused",
    branch,
    commit,
    reason: "The branch forge/integration is the branch work is merged into, named as into, so it is kept.",
  };
  assert.deepEqual(dropVerdict({ ...facts, branch, into: branch }), refused);
  assert.deepEqual(dropVerdict({ ...facts, branch, into: `refs/heads/${branch}` }), refused);
  assert.deepEqual(dropVerdict({ ...facts, branch, into: "integration" }), { how: "drop", commit });
});

test("the branch the project's own folder has checked out is refused, with what to do", () => {
  assert.deepEqual(dropVerdict({ ...facts, checkedOut: "forge/mail-source-planter" }), {
    how: "refused",
    branch: "forge/mail-source-planter",
    commit,
    reason:
      "The project's own folder has the branch forge/mail-source-planter checked out, so it is kept. Switch the " +
      "folder to another branch, then drop it again.",
  });
});

test("a branch a live worktree of the mode still has is refused, with what to do", () => {
  assert.deepEqual(dropVerdict({ ...facts, liveWorktree: ".forge/worktrees/mail-source-planter" }), {
    how: "refused",
    branch: "forge/mail-source-planter",
    commit,
    reason:
      "The worktree .forge/worktrees/mail-source-planter of this mode still has the branch " +
      "forge/mail-source-planter, so it is kept. Remove the worktree first, with branchAfter kept, then drop the " +
      "branch again.",
  });
});

test("a cut over a leftover branch names the branch and its commit, and says to drop it or choose another name", () => {
  assert.equal(
    leftoverSentence({ slice: "mail-source", branch: "forge/mail-source", commit }),
    `The branch forge/mail-source already exists at the commit ${commit}, so the slice mail-source is not cut ` +
      "again. Drop the branch with drop-branch, which answers that commit so its work can be found again, or cut " +
      "the slice under another name.",
  );
});
