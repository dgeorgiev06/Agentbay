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
  type ModeTestRun,
} from "./kit-copy.ts";
import { copyOfTheKit } from "./test-toolbox.ts";
import { almanac, almanacFiles, wrongAlmanac } from "./made-up-sources.ts";

const modesFolder = "components/modes";

const casesThatCatchARepeatedItem: readonly string[] = [
  "fetching every page with the cursor gives every item once, oldest first, in the pages given, " +
    "and more is false only on the last",
  "the cursor of the last page gives no items and more false",
  "after the project is opened again, a page's cursor continues with the next page, and the last one with nothing",
  "no page costs less than nothing or more than describe's pageCostUsd, and the walk costs what the mode's test says",
].map((name) => `items-source@1, ${wrongAlmanac}: ${name}`);

let copy: string;

let almanacTested: ModeTestRun;

let wrongAlmanacTested: ModeTestRun;

before(async () => {
  copy = await copyOfTheKit("sources");
  await addMode(copy, join(modesFolder, almanac), almanacFiles(almanac, "continues after the cursor"));
  await addMode(copy, join(modesFolder, wrongAlmanac), almanacFiles(wrongAlmanac, "repeats the item at the cursor"));
  [almanacTested, wrongAlmanacTested] = await Promise.all([
    modeTestRan(copy, modeTestFile(modesFolder, almanac), "every case"),
    modeTestRan(copy, modeTestFile(modesFolder, wrongAlmanac), { only: casesThatCatchARepeatedItem }),
  ]);
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("a made-up source with two kinds, pages of four and a price per page passes items-source@1's shared test", () => {
  assert.deepEqual(failedTests(almanacTested.output), []);
  assert.equal(almanacTested.status, 0, almanacTested.output);
  assert.match(almanacTested.output, /^# pass 13$/m);
});

test("a made-up source that repeats the last item of a page at the start of the next fails the shared test", () => {
  assertFailsOnlyTheChosenCases(wrongAlmanacTested, casesThatCatchARepeatedItem);
});
