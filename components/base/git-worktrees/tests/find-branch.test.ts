import assert from "node:assert/strict";
import { test } from "node:test";
import { foundAt, refusedToFind } from "../scripts/lib/find.ts";
import { git, openRepositoryProject, refsAndWorktrees } from "./repository.ts";

const commit = "79fe81d1c4a6b0e2f3d5a7c9e1b3d5f7a9c1e3b5";

function notMade(branch: string): string {
  return `The branch ${branch} is not one this mode makes, forge/<slice> or forge/wip/<slice>/<n>, so the mode does not look at it.`;
}

test("find-branch reads only a branch the mode makes, and refuses another shape under forge/ with the reason", () => {
  for (const branch of ["forge/a", "forge/mail-source-tests-1", "forge/wip/a/1"]) {
    assert.equal(refusedToFind(branch), undefined, branch);
  }
  for (const branch of ["forge/wip", "forge/wip/a", "forge/a/b", "forge/wip/a/0"]) {
    assert.deepEqual(refusedToFind(branch), { how: "refused", branch, reason: notMade(branch) });
  }
});

test("a branch found answers its commit, and one that is not there says so", () => {
  assert.deepEqual(foundAt("forge/a", commit), { how: "found", branch: "forge/a", commit });
  assert.deepEqual(foundAt("forge/a", undefined), { how: "not-there", branch: "forge/a" });
});

test("find-branch answers a branch the project's own folder has checked out, refuses forge/wip with no commit, and changes nothing", async () => {
  const project = await openRepositoryProject();
  try {
    git(project, ".", ["branch", "forge/wip", "main"]);
    git(project, ".", ["switch", "--quiet", "--create", "forge/here"]);
    const before = refsAndWorktrees(project);
    assert.deepEqual(await project.output("git-worktrees.find-branch", { branch: "forge/here" }), {
      how: "found",
      branch: "forge/here",
      commit: project.base,
    });
    assert.deepEqual(await project.output("git-worktrees.find-branch", { branch: "forge/wip" }), {
      how: "refused",
      branch: "forge/wip",
      reason: notMade("forge/wip"),
    });
    assert.equal(refsAndWorktrees(project), before);
  } finally {
    await project.close();
  }
});
