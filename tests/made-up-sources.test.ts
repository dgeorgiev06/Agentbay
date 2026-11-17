import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addMode, copyOfTheKit, failedTests } from "./kit-copy.ts";
import { almanac, almanacFiles, wrongAlmanac } from "./made-up-sources.ts";

type Ran = {
  readonly status: number | null;
  readonly output: string;
};

const modesFolder = "components/modes";

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

let copy: string;

function modeTestRan(name: string): Ran {
  const file = join(modesFolder, name, "tests", `${name}.test.ts`);
  const result = spawnSync(process.execPath, ["--test", file], { cwd: copy, env: environment, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

before(async () => {
  copy = await copyOfTheKit("sources");
  await addMode(copy, join(modesFolder, almanac), almanacFiles(almanac, "continues after the cursor"));
  await addMode(copy, join(modesFolder, wrongAlmanac), almanacFiles(wrongAlmanac, "repeats the item at the cursor"));
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("a made-up source with two kinds, pages of four and a price per page passes items-source@1's shared test", () => {
  const tested = modeTestRan(almanac);
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.match(tested.output, /^# pass 13$/m);
});

test("a made-up source that repeats the last item of a page at the start of the next fails the shared test", () => {
  const tested = modeTestRan(wrongAlmanac);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(
    failedTests(tested.output),
    [
      "fetching every page with the cursor gives every item once, oldest first, in the pages given, " +
        "and more is false only on the last",
      "the cursor of the last page gives no items and more false",
      "after the project is opened again, a page's cursor continues with the next page, and the last one with nothing",
      "no page costs less than nothing or more than describe's pageCostUsd, and the walk costs what the mode's test says",
    ].map((name) => `items-source@1, ${wrongAlmanac}: ${name}`),
  );
});
