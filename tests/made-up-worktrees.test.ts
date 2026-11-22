import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  addMode,
  assertFailsOnlyTheChosenCases,
  modeTestFile,
  modeTestRan,
  nodeRanIn,
  type ModeTestRun,
} from "./kit-copy.ts";
import { copyOfTheKit } from "./test-toolbox.ts";
import {
  absentFailingShelf,
  liveDroppingShelf,
  shelf,
  shelfFiles,
  strayFindingShelf,
  wrongShelf,
  type ShelfVariant,
} from "./made-up-worktrees.ts";

const baseFolder = "components/base";

const removeKeepsAChangedWorktree =
  "remove refuses a worktree with an untracked or a changed file, and keeps it, its files and its branch";

const dropAnswersNotThere =
  "drop-branch deletes a branch the mode made, merged or not, and answers the commit it pointed at; a second drop " +
  "answers not-there, and the slice can be cut again";

const dropKeepsALiveWorktreesBranch =
  "drop-branch keeps a branch a live worktree of the mode still has, the branch named as into, and a branch under " +
  "forge/ the mode never makes, and answers refused with its commit; once the worktree is removed its branch goes";

const findReadsOnlyMadeBranches =
  "find-branch answers the commit a branch the mode made points at, a live worktree's branch too, and not-there " +
  "for one it does not have; it refuses a branch under forge/ the mode never makes with a reason, and changes nothing";

type Wrong = {
  readonly name: string;
  readonly variant: ShelfVariant;
  readonly fails: string;
};

const wrongShelves: readonly Wrong[] = [
  { name: wrongShelf, variant: "removes a changed worktree", fails: removeKeepsAChangedWorktree },
  { name: liveDroppingShelf, variant: "drops a branch a live worktree has", fails: dropKeepsALiveWorktreesBranch },
  { name: absentFailingShelf, variant: "fails on a branch not there", fails: dropAnswersNotThere },
  { name: strayFindingShelf, variant: "finds a branch it does not make", fails: findReadsOnlyMadeBranches },
];

let copy: string;

let checked: ModeTestRun;

let wrongShelvesTested: readonly ModeTestRun[];

function casesOf(name: string, cases: readonly string[]): readonly string[] {
  return cases.map((entry) => `worktrees@1, ${name}: ${entry}`);
}

before(async () => {
  copy = await copyOfTheKit("worktrees");
  await addMode(copy, join(baseFolder, shelf), shelfFiles(shelf, "keeps a changed worktree"));
  for (const wrong of wrongShelves) {
    await addMode(copy, join(baseFolder, wrong.name), shelfFiles(wrong.name, wrong.variant));
  }
  [checked, ...wrongShelvesTested] = await Promise.all([
    nodeRanIn(copy, ["bay/cli.ts", "check"]),
    ...wrongShelves.map((wrong) =>
      modeTestRan(copy, modeTestFile(baseFolder, wrong.name), { only: casesOf(wrong.name, [wrong.fails]) }),
    ),
  ]);
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("bay check accepts a made-up worktrees mode that keeps commits as files and runs the shared test", () => {
  assert.equal(checked.status, 0, checked.output);
  assert.match(checked.output, /^bay check: 0 errors, /m);
});

for (const [index, wrong] of wrongShelves.entries()) {
  test(`a made-up worktrees mode that ${wrong.variant} fails the shared test's case on it`, () => {
    const tested = wrongShelvesTested[index];
    assert.ok(tested !== undefined);
    assertFailsOnlyTheChosenCases(tested, casesOf(wrong.name, [wrong.fails]));
  });
}
