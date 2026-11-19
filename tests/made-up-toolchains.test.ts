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
  type Cases,
  type ModeTestRun,
} from "./kit-copy.ts";
import {
  besideTally,
  kernelStateTally,
  lacksNothingTally,
  notSetUpTally,
  onceTally,
  rootTally,
  tally,
  tallyFiles,
  unloadedAsCaseTally,
  wrongTally,
  type TallyVariant,
} from "./made-up-toolchains.ts";

const baseFolder = "components/base";

const modes: Readonly<Record<string, TallyVariant>> = {
  [tally]: "stops a check at its limit",
  [wrongTally]: "passes a check stopped at its limit",
  [besideTally]: "writes its build output beside the folder",
  [rootTally]: "writes its build output in the project's root",
  [kernelStateTally]: "writes its build output in the kernel's state folder",
  [onceTally]: "builds only into a folder with no build output",
  [notSetUpTally]: "passes a check the checkout is not set up for",
  [lacksNothingTally]: "says the project lacks nothing",
  [unloadedAsCaseTally]: "names a file that did not load as a failing case",
};

const writesOutsideTheFolder =
  "check and test write nothing outside the folder they are given, anywhere in the project";

const caseThatCatches: Readonly<Record<string, string>> = {
  [wrongTally]:
    "a check that does not end within its time limit is stopped and inconclusive, " +
    "its time is reported, and the checks after it still run",
  [besideTally]: writesOutsideTheFolder,
  [rootTally]: writesOutsideTheFolder,
  [kernelStateTally]: writesOutsideTheFolder,
  [onceTally]: "a second check and test on the same folder, after the first wrote there, give the same verdicts",
  [notSetUpTally]: "a check the checkout is not set up for is inconclusive, and the checks after it still run",
  [lacksNothingTally]:
    "describe says which checks and whether the test run the project is set up for, and what to add for the rest",
  [unloadedAsCaseTally]:
    "a test file that does not load is named in notLoaded and is no failing case, " +
    "and the failing cases of the other files are still listed",
};

let copy: string;

let ranByMode: Readonly<Record<string, ModeTestRun>>;

function ranFor(name: string): ModeTestRun {
  const ran = ranByMode[name];
  assert.ok(ran !== undefined, name);
  return ran;
}

function catchingCaseOf(name: string): string {
  const statement = caseThatCatches[name];
  assert.ok(statement !== undefined, `no case is named to catch ${name}`);
  return `toolchain@1, ${name}: ${statement}`;
}

function casesFor(name: string): Cases {
  return name === tally ? "every case" : { only: [catchingCaseOf(name)] };
}

function assertCaught(name: string): void {
  assertFailsOnlyTheChosenCases(ranFor(name), [catchingCaseOf(name)]);
}

before(async () => {
  assert.deepEqual(
    Object.keys(caseThatCatches).sort(),
    Object.keys(modes)
      .filter((name) => name !== tally)
      .sort(),
  );
  copy = await copyOfTheKit("toolchains");
  for (const [name, variant] of Object.entries(modes)) {
    await addMode(copy, join(baseFolder, name), tallyFiles(name, variant));
  }
  const ran = await Promise.all(
    Object.keys(modes).map(async (name): Promise<readonly [string, ModeTestRun]> => [
      name,
      await modeTestRan(copy, modeTestFile(baseFolder, name), casesFor(name)),
    ]),
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
  assert.match(tested.output, /^# pass 26$/m);
});

test("a made-up toolchain that reports passed for a check stopped at its limit fails the shared test's case on it", () => {
  assertCaught(wrongTally);
});

test("a made-up toolchain whose build writes beside the folder it is given fails the shared test's case on writing outside the folder", () => {
  assertCaught(besideTally);
});

test("a made-up toolchain whose build writes in the project's root fails the shared test's case on writing outside the folder", () => {
  assertCaught(rootTally);
});

test("a made-up toolchain whose build writes in the kernel's state folder fails the shared test's case on writing outside the folder", () => {
  assertCaught(kernelStateTally);
});

test("a made-up toolchain whose build fails where it has built before fails the shared test's case on a second call", () => {
  assertCaught(onceTally);
});

test("a made-up toolchain that reports passed for a check the checkout is not set up for fails the shared test's case on it", () => {
  assertCaught(notSetUpTally);
});

test("a made-up toolchain whose describe says the project lacks nothing fails the shared test's case on what the project is set up for", () => {
  assertCaught(lacksNothingTally);
});

test("a made-up toolchain that names a test file that did not load as a failing case fails the shared test's case on files that do not load", () => {
  assertCaught(unloadedAsCaseTally);
});
