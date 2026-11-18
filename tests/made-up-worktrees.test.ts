import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  addMode,
  assertFailsOnlyTheChosenCases,
  copyOfTheKit,
  failedTests,
  modeTestFile,
  modeTestRan,
  nodeRanIn,
  type ModeTestRun,
} from "./kit-copy.ts";
import { casesThatNeedMergeSetAsideOrApply, shelf, shelfFiles, wrongShelf } from "./made-up-worktrees.ts";

const baseFolder = "components/base";

const removeKeepsAChangedWorktree =
  "remove refuses a worktree with an untracked or a changed file, and keeps it, its files and its branch";

let copy: string;

let checked: ModeTestRun;

let shelfTested: ModeTestRun;

let wrongShelfTested: ModeTestRun;

function casesOf(name: string, cases: readonly string[]): readonly string[] {
  return cases.map((entry) => `worktrees@1, ${name}: ${entry}`);
}

before(async () => {
  copy = await copyOfTheKit("worktrees");
  await addMode(copy, join(baseFolder, shelf), shelfFiles(shelf, "keeps a changed worktree"));
  await addMode(copy, join(baseFolder, wrongShelf), shelfFiles(wrongShelf, "removes a changed worktree"));
  [checked, shelfTested, wrongShelfTested] = await Promise.all([
    nodeRanIn(copy, ["bay/cli.ts", "check"]),
    modeTestRan(copy, modeTestFile(baseFolder, shelf), "every case"),
    modeTestRan(copy, modeTestFile(baseFolder, wrongShelf), {
      only: casesOf(wrongShelf, [removeKeepsAChangedWorktree]),
    }),
  ]);
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("bay check accepts a made-up worktrees mode that keeps commits as files and runs the shared test", () => {
  assert.equal(checked.status, 0, checked.output);
  assert.match(checked.output, /^bay check: 0 errors, /m);
});

test("a made-up worktrees mode passes every case of the shared test that its six built actions answer", () => {
  assert.equal(shelfTested.status, 1, shelfTested.output);
  assert.deepEqual(failedTests(shelfTested.output), casesOf(shelf, casesThatNeedMergeSetAsideOrApply));
  assert.match(shelfTested.output, /^# pass 25$/m);
});

test("a made-up worktrees mode whose remove deletes a worktree with a changed file fails the shared test's case on it", () => {
  assertFailsOnlyTheChosenCases(wrongShelfTested, casesOf(wrongShelf, [removeKeepsAChangedWorktree]));
});
