import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addMode, copyOfTheKit, failedTests } from "./kit-copy.ts";
import { casesThatNeedMergeSetAsideOrApply, shelf, shelfFiles, wrongShelf } from "./made-up-worktrees.ts";

type Ran = {
  readonly status: number | null;
  readonly output: string;
};

const baseFolder = "components/base";

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

const removeKeepsAChangedWorktree =
  "remove refuses a worktree with an untracked or a changed file, and keeps it, its files and its branch";

let copy: string;

function modeTestRan(name: string): Ran {
  const file = join(baseFolder, name, "tests", `${name}.test.ts`);
  const result = spawnSync(process.execPath, ["--test", file], { cwd: copy, env: environment, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function casesOf(name: string, cases: readonly string[]): readonly string[] {
  return cases.map((entry) => `worktrees@1, ${name}: ${entry}`);
}

function bayCheckRan(): Ran {
  const result = spawnSync(process.execPath, ["bay/cli.ts", "check"], {
    cwd: copy,
    env: environment,
    input: "",
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

before(async () => {
  copy = await copyOfTheKit("worktrees");
  await addMode(copy, join(baseFolder, shelf), shelfFiles(shelf, "keeps a changed worktree"));
  await addMode(copy, join(baseFolder, wrongShelf), shelfFiles(wrongShelf, "removes a changed worktree"));
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("bay check accepts a made-up worktrees mode that keeps commits as files and runs the shared test", () => {
  const checked = bayCheckRan();
  assert.equal(checked.status, 0, checked.output);
  assert.match(checked.output, /^bay check: 0 errors, /m);
});

test("a made-up worktrees mode passes every case of the shared test that its six built actions answer", () => {
  const tested = modeTestRan(shelf);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), casesOf(shelf, casesThatNeedMergeSetAsideOrApply));
  assert.match(tested.output, /^# pass 25$/m);
});

test("a made-up worktrees mode whose remove deletes a worktree with a changed file fails the shared test's case on it", () => {
  const tested = modeTestRan(wrongShelf);
  assert.equal(tested.status, 1, tested.output);
  const failed = failedTests(tested.output);
  assert.deepEqual(
    failed.filter((name) => !casesOf(wrongShelf, casesThatNeedMergeSetAsideOrApply).includes(name)),
    casesOf(wrongShelf, [removeKeepsAChangedWorktree]),
  );
  assert.equal(failed.length, casesThatNeedMergeSetAsideOrApply.length + 1);
});
