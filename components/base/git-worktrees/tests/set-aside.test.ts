import assert from "node:assert/strict";
import { test } from "node:test";
import { git, openRepositoryProject, writeFiles } from "./repository.ts";

const folder = ".forge/worktrees/feature";

test("the set-aside commit says whose work it holds and names the mode as its author", async () => {
  const project = await openRepositoryProject();
  try {
    await project.output("git-worktrees.cut", { slice: "feature", base: "main" });
    await writeFiles(project, folder, { "notes/new.txt": "new\n" });
    const output = await project.output("git-worktrees.set-aside", { folder });
    assert.deepEqual(output, {
      how: "set-aside",
      folder,
      branch: "forge/wip/feature/1",
      commit: git(project, ".", ["rev-parse", "forge/wip/feature/1"]).trim(),
    });
    assert.equal(
      git(project, ".", ["log", "-1", "--format=%s|%an <%ae>", "forge/wip/feature/1"]),
      "Set aside the changed and untracked files of forge/feature.|" +
        "agentbay-git-worktrees <git-worktrees@agentbay.invalid>\n",
    );
  } finally {
    await project.close();
  }
});
