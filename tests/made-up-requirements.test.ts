import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  addMode,
  assertFailsOnlyTheChosenCases,
  failedTests,
  modeTestFile,
  modeTestRan,
  nodeRanIn,
  type ModeTestRun,
} from "./kit-copy.ts";
import { copyOfTheKit } from "./test-toolbox.ts";
import { casesCaughtByEachVariant, checklist, checklistFiles, type ChecklistVariant } from "./made-up-requirements.ts";

type WrongVariant = keyof typeof casesCaughtByEachVariant;

type WrongRun = {
  readonly variant: WrongVariant;
  readonly name: string;
  readonly tested: ModeTestRun;
};

const modesFolder = "components/modes";

const wrongVariants: readonly WrongVariant[] = [
  "finds no id given twice",
  "counts lines from 0",
  "checks the rules only when the form passes",
  "takes no noRefusal",
  "matches a word inside a longer word",
  "looks inside quoted values",
];

let copy: string;

let checked: ModeTestRun;

let checklistTested: ModeTestRun;

let wrongRuns: readonly WrongRun[];

function caseOf(name: string, entry: string): string {
  return `requirements@1, ${name}: ${entry}`;
}

function wrongName(index: number): string {
  return `${checklist}-wrong-${String(index + 1)}`;
}

async function added(name: string, variant: ChecklistVariant): Promise<void> {
  await addMode(copy, join(modesFolder, name), checklistFiles(name, variant));
}

before(async () => {
  copy = await copyOfTheKit("requirements");
  await added(checklist, "checks as the base mode does");
  for (const [index, variant] of wrongVariants.entries()) {
    await added(wrongName(index), variant);
  }
  const wrongTested = wrongVariants.map((variant, index) =>
    modeTestRan(copy, modeTestFile(modesFolder, wrongName(index)), {
      only: [caseOf(wrongName(index), casesCaughtByEachVariant[variant])],
    }),
  );
  const [checkRun, checklistRun, ...wrongDone] = await Promise.all([
    nodeRanIn(copy, ["bay/cli.ts", "check"]),
    modeTestRan(copy, modeTestFile(modesFolder, checklist), "every case"),
    ...wrongTested,
  ]);
  checked = checkRun;
  checklistTested = checklistRun;
  wrongRuns = wrongVariants.map((variant, index) => {
    const tested = wrongDone[index];
    assert.ok(tested !== undefined);
    return { variant, name: wrongName(index), tested };
  });
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("bay check accepts a made-up requirements mode beside the kit's own, both implementing requirements@1", () => {
  assert.equal(checked.status, 0, checked.output);
  assert.match(checked.output, /^bay check: 0 errors, /m);
});

test("a made-up requirements mode passes every case of requirements@1's shared test", () => {
  assert.deepEqual(failedTests(checklistTested.output), []);
  assert.equal(checklistTested.status, 0, checklistTested.output);
  assert.match(checklistTested.output, /^# pass 24$/m);
});

for (const variant of wrongVariants) {
  test(`a made-up requirements mode that ${variant} fails the shared test's case that catches it`, () => {
    const run = wrongRuns.find((each) => each.variant === variant);
    assert.ok(run !== undefined);
    assertFailsOnlyTheChosenCases(run.tested, [caseOf(run.name, casesCaughtByEachVariant[variant])]);
  });
}
