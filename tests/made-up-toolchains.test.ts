import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addMode, copyOfTheKit, failedTests } from "./kit-copy.ts";
import {
  besideTally,
  kernelStateTally,
  lacksNothingTally,
  notSetUpTally,
  onceTally,
  rootTally,
  tally,
  tallyFiles,
  wrongTally,
  type TallyVariant,
} from "./made-up-toolchains.ts";

type Ran = {
  readonly status: number | null;
  readonly output: string;
};

const baseFolder = "components/base";

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

const modes: Readonly<Record<string, TallyVariant>> = {
  [tally]: "stops a check at its limit",
  [wrongTally]: "passes a check stopped at its limit",
  [besideTally]: "writes its build output beside the folder",
  [rootTally]: "writes its build output in the project's root",
  [kernelStateTally]: "writes its build output in the kernel's state folder",
  [onceTally]: "builds only into a folder with no build output",
  [notSetUpTally]: "passes a check the checkout is not set up for",
  [lacksNothingTally]: "says the project lacks nothing",
};

const writesOutsideTheFolder =
  "check and test write nothing outside the folder they are given, anywhere in the project";

let copy: string;

let ranByMode: Readonly<Record<string, Ran>>;

function modeTestRan(name: string): Promise<Ran> {
  const file = join(baseFolder, name, "tests", `${name}.test.ts`);
  const child = spawn(process.execPath, ["--test", file], { cwd: copy, env: environment });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  return new Promise((resolve) => {
    child.on("close", (status) => {
      resolve({ status, output });
    });
  });
}

function ranFor(name: string): Ran {
  const ran = ranByMode[name];
  assert.ok(ran !== undefined, name);
  return ran;
}

function caseOf(name: string, statement: string): string {
  return `toolchain@1, ${name}: ${statement}`;
}

before(async () => {
  copy = await copyOfTheKit("toolchains");
  for (const [name, variant] of Object.entries(modes)) {
    await addMode(copy, join(baseFolder, name), tallyFiles(name, variant));
  }
  const ran = await Promise.all(
    Object.keys(modes).map(async (name): Promise<readonly [string, Ran]> => [name, await modeTestRan(name)]),
  );
  ranByMode = Object.fromEntries(ran);
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("a made-up toolchain for another language, whose checks are listed commands and one of which writes a build output inside the folder, passes toolchain@1's shared test", () => {
  const tested = ranFor(tally);
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.match(tested.output, /^# pass 19$/m);
});

test("a made-up toolchain that reports passed for a check stopped at its limit fails the shared test's case on it", () => {
  const tested = ranFor(wrongTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [
    caseOf(
      wrongTally,
      "a check that does not end within its time limit is stopped and inconclusive, " +
        "its time is reported, and the checks after it still run",
    ),
  ]);
});

test("a made-up toolchain whose build writes beside the folder it is given fails the shared test's case on writing outside the folder", () => {
  const tested = ranFor(besideTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [caseOf(besideTally, writesOutsideTheFolder)]);
});

test("a made-up toolchain whose build writes in the project's root fails the shared test's case on writing outside the folder", () => {
  const tested = ranFor(rootTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [caseOf(rootTally, writesOutsideTheFolder)]);
});

test("a made-up toolchain whose build writes in the kernel's state folder fails the shared test's case on writing outside the folder", () => {
  const tested = ranFor(kernelStateTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [caseOf(kernelStateTally, writesOutsideTheFolder)]);
});

test("a made-up toolchain whose build fails where it has built before fails the shared test's case on a second call", () => {
  const tested = ranFor(onceTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [
    caseOf(
      onceTally,
      "a second check and test on the same folder, after the first wrote there, give the same verdicts",
    ),
  ]);
});

test("a made-up toolchain that reports passed for a check the checkout is not set up for fails the shared test's case on it", () => {
  const tested = ranFor(notSetUpTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [
    caseOf(notSetUpTally, "a check the checkout is not set up for is inconclusive, and the checks after it still run"),
  ]);
});

test("a made-up toolchain whose describe says the project lacks nothing fails the shared test's case on what the project is set up for", () => {
  const tested = ranFor(lacksNothingTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [
    caseOf(
      lacksNothingTally,
      "describe says which checks and whether the test run the project is set up for, and what to add for the rest",
    ),
  ]);
});
