import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addMode, copyOfTheKit, failedTests } from "./kit-copy.ts";
import { tally, tallyFiles, wrongTally } from "./made-up-toolchains.ts";

type Ran = {
  readonly status: number | null;
  readonly output: string;
};

const baseFolder = "components/base";

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

let copy: string;

function modeTestRan(name: string): Ran {
  const file = join(baseFolder, name, "tests", `${name}.test.ts`);
  const result = spawnSync(process.execPath, ["--test", file], { cwd: copy, env: environment, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

before(async () => {
  copy = await copyOfTheKit("toolchains");
  await addMode(copy, join(baseFolder, tally), tallyFiles(tally, "stops a check at its limit"));
  await addMode(copy, join(baseFolder, wrongTally), tallyFiles(wrongTally, "passes a check stopped at its limit"));
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("a made-up toolchain for another language, whose checks are listed commands, passes toolchain@1's shared test", () => {
  const tested = modeTestRan(tally);
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.match(tested.output, /^# pass 15$/m);
});

test("a made-up toolchain that reports passed for a check stopped at its limit fails the shared test's case on it", () => {
  const tested = modeTestRan(wrongTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [
    `toolchain@1, ${wrongTally}: a check that does not end within its time limit is stopped and inconclusive, ` +
      "its time is reported, and the checks after it still run",
  ]);
});
