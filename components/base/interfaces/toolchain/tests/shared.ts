import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { openModeProject, type ModeProject, type TestProject } from "../../../../../tests/test-toolbox.ts";

export type Files = Readonly<Record<string, string>>;

export type Outcome = "passes" | "fails" | "does not end";

export type CheckOutcome = Outcome | "not set up";

export type WantedCheck = {
  readonly name: string;
  readonly outcome: CheckOutcome;
  readonly line: string;
};

export type WantedTest =
  | { readonly name: string; readonly outcome: "passes" | "does not end" }
  | { readonly name: string; readonly outcome: "fails"; readonly message: string };

export type WantedTestFile = readonly WantedTest[] | "does not load";

export type TestRun = "set up" | "not set up";

export type Wanted = {
  readonly checks: readonly WantedCheck[];
  readonly testRun: TestRun;
  readonly testFiles: readonly WantedTestFile[];
};

export type ToolchainUnderTest = {
  readonly mode: string;
  readonly checkout: (wanted: Wanted) => Files;
};

type Value = Awaited<ReturnType<ModeProject["output"]>>;

type Fields = { readonly [key: string]: Value };

type Description = {
  readonly language: string;
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly practices: string;
  readonly checks: readonly string[];
  readonly present: readonly string[];
  readonly missing: readonly Fields[];
};

type Toolchain = {
  readonly describe: () => Promise<Description>;
  readonly describeRun: () => ReturnType<ModeProject["run"]>;
  readonly check: (input: Fields) => Promise<Value>;
  readonly test: (input: Fields) => Promise<Value>;
  readonly failure: (action: string, input: Fields) => Promise<string>;
  readonly refusal: (action: string, input: Fields) => Promise<string>;
  readonly whyInconclusive: (outputs: readonly Value[]) => string;
  readonly write: (label: string, wanted: Wanted) => Promise<string>;
  readonly writeInTheRoot: (wanted: Wanted) => Promise<() => Promise<void>>;
  readonly modeFolder: () => string;
  readonly filesIn: (folder: string) => Promise<Files>;
  readonly projectOutsideTheFolders: () => Promise<Files>;
  readonly projectAsOpened: Files;
};

type Case = {
  readonly name: string;
  readonly run: (toolchain: Toolchain) => Promise<void>;
};

const interfaceName = "toolchain";

const kit = fileURLToPath(new URL("../../../../../", import.meta.url));

const checkSeconds = 120;

const testSeconds = 120;

const testRunName = "test";

const stopAfterSeconds = 2;

const waitedSeconds = 30;

const longestSeconds = 1000;

const unknownCheck = "no-such-check";

const checkoutsFolder = "checkouts";

const missingFolder = join(checkoutsFolder, "nowhere");

const givenReason = "a reason is given";

const kernelStateFolder = ".agentbay";

const kernelDatabase = /\.db(-wal|-shm|-journal)?$/;

const sums: readonly WantedTest[] = [
  { name: "one and one make two", outcome: "passes" },
  { name: "two and two make four", outcome: "passes" },
];

const words: readonly WantedTest[] = [{ name: "a word has letters", outcome: "passes" }];

const wrongSumName = "a sum that is wrong";

const wrongSum: readonly WantedTest[] = [
  { name: wrongSumName, outcome: "fails", message: "the sum is wrong\n1 + 1 gives 2, not 3" },
];

const wrongSumMessage = "the sum is wrong";

const wrongTwiceName = "a sum that is wrong twice";

const twoWrongSums: readonly WantedTest[] = [
  { name: "one and one make two", outcome: "passes" },
  { name: wrongTwiceName, outcome: "fails", message: "the first sum is wrong" },
  { name: wrongTwiceName, outcome: "fails", message: "the second sum is wrong\n2 + 2 gives 4, not 5" },
];

const wrongProductName = "a product that is wrong";

const wrongProduct: readonly WantedTest[] = [
  { name: wrongProductName, outcome: "fails", message: "\n   the product is wrong  \n2 * 2 gives 4, not 5" },
];

const longestMessage = 200;

const mostFailures = 50;

const waits: readonly WantedTest[] = [{ name: "waits for ever", outcome: "does not end" }];

function isFields(value: Value): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Value | undefined): value is readonly Value[] {
  return Array.isArray(value);
}

function fieldsOf(value: Value): Fields {
  assert.ok(isFields(value), JSON.stringify(value));
  return value;
}

function textsOf(value: Value | undefined): readonly string[] {
  assert.ok(isList(value) && value.every((entry) => typeof entry === "string"), JSON.stringify(value));
  return value.filter((entry): entry is string => typeof entry === "string");
}

function textOf(value: Value | undefined): string {
  assert.ok(typeof value === "string", JSON.stringify(value));
  return value;
}

function shownMissing(value: Value): Fields {
  const fields = fieldsOf(value);
  assert.deepEqual(keysOf(value), ["name", "reason"]);
  return { name: textOf(fields.name), reason: givenReasonOf(fields) };
}

function missingOf(value: Value | undefined): readonly Fields[] {
  assert.ok(isList(value), JSON.stringify(value));
  return value.map(shownMissing);
}

function descriptionOf(value: Value): Description {
  const fields = fieldsOf(value);
  return {
    language: textOf(fields.language),
    sourceFiles: textsOf(fields.sourceFiles),
    testFiles: textsOf(fields.testFiles),
    practices: textOf(fields.practices),
    checks: textsOf(fields.checks),
    present: textsOf(fields.present),
    missing: missingOf(fields.missing),
  };
}

function lastLineOf(output: string): string {
  const lines = output.split("\n").filter((line) => line.trim() !== "");
  return lines[lines.length - 1] ?? "";
}

function secondsOf(value: Value): number {
  const seconds = fieldsOf(value).seconds;
  assert.ok(typeof seconds === "number" && seconds >= 0, JSON.stringify(value));
  return seconds;
}

function keysOf(value: Value): readonly string[] {
  return Object.keys(fieldsOf(value)).sort();
}

function givenReasonOf(fields: Fields): string {
  assert.ok(typeof fields.reason === "string" && fields.reason.trim() !== "", JSON.stringify(fields));
  return givenReason;
}

function shownVerdict(value: Value): Fields {
  const fields = fieldsOf(value);
  secondsOf(value);
  const stdout = textOf(fields.stdout);
  textOf(fields.stderr);
  const { name, verdict } = fields;
  if (verdict === "inconclusive") {
    assert.deepEqual(keysOf(value), ["name", "reason", "seconds", "stderr", "stdout", "verdict"]);
    return { name: name ?? null, verdict, reason: givenReasonOf(fields) };
  }
  assert.deepEqual(keysOf(value), ["name", "seconds", "stderr", "stdout", "verdict"]);
  return { name: name ?? null, verdict: verdict ?? null, lastLine: lastLineOf(stdout) };
}

function shownTestResult(value: Value): Fields {
  const fields = fieldsOf(value);
  secondsOf(value);
  textOf(fields.stdout);
  textOf(fields.stderr);
  const { verdict, passed, failed, failedTests } = fields;
  if (verdict === "inconclusive") {
    assert.deepEqual(keysOf(value), ["reason", "seconds", "stderr", "stdout", "verdict"]);
    return { verdict, reason: givenReasonOf(fields) };
  }
  const counts = {
    verdict: verdict ?? null,
    passed: passed ?? null,
    failed: failed ?? null,
    failedTests: failedTests ?? null,
  };
  if (verdict === "failed") {
    assert.deepEqual(keysOf(value), [
      "failed",
      "failedTests",
      "failures",
      "failuresNotListed",
      "notLoaded",
      "passed",
      "seconds",
      "stderr",
      "stdout",
      "verdict",
    ]);
    const { failures, failuresNotListed, notLoaded } = casesOf(fields);
    return { ...counts, failures, failuresNotListed, notLoaded };
  }
  assert.deepEqual(keysOf(value), ["failed", "failedTests", "passed", "seconds", "stderr", "stdout", "verdict"]);
  return counts;
}

type FailingCase = {
  readonly name: string;
  readonly file: string;
  readonly message: string;
  readonly charactersCut: number;
};

type Cases = {
  readonly failures: readonly FailingCase[];
  readonly failuresNotListed: number;
  readonly notLoaded: readonly string[];
};

function countOf(value: Value | undefined): number {
  assert.ok(typeof value === "number" && Number.isInteger(value) && value >= 0, JSON.stringify(value));
  return value;
}

function shownFailure(value: Value): FailingCase {
  const fields = fieldsOf(value);
  assert.deepEqual(keysOf(value), ["charactersCut", "file", "message", "name"]);
  return {
    name: textOf(fields.name),
    file: textOf(fields.file),
    message: textOf(fields.message),
    charactersCut: countOf(fields.charactersCut),
  };
}

function casesOf(fields: Fields): Cases {
  const { failures } = fields;
  assert.ok(isList(failures), JSON.stringify(fields));
  return {
    failures: failures.map(shownFailure),
    failuresNotListed: countOf(fields.failuresNotListed),
    notLoaded: textsOf(fields.notLoaded),
  };
}

function inFileOrder(failures: readonly FailingCase[]): readonly FailingCase[] {
  return [...failures].sort((left, right) => left.file.localeCompare(right.file));
}

function shownCases(value: Value): Fields | Cases {
  const fields = fieldsOf(value);
  if (fields.verdict !== "failed") {
    return shownTestResult(value);
  }
  shownTestResult(value);
  const { failures, failuresNotListed, notLoaded } = casesOf(fields);
  return { failures: inFileOrder(failures), failuresNotListed, notLoaded: [...notLoaded].sort() };
}

function failingCase(name: string, file: string, message: string): FailingCase {
  return { name, file, message, charactersCut: 0 };
}

function failedOnWrongSum(passed: number, file: string): Fields {
  return {
    verdict: "failed",
    passed,
    failed: 1,
    failedTests: [wrongSumName],
    failures: [failingCase(wrongSumName, file, wrongSumMessage)],
    failuresNotListed: 0,
    notLoaded: [],
  };
}

function verdictsOf(output: Value): readonly Value[] {
  const verdicts = fieldsOf(output).verdicts;
  assert.ok(isList(verdicts), JSON.stringify(output));
  return verdicts;
}

function reasonsGiven(outputs: readonly Value[]): readonly string[] {
  return outputs.flatMap((output) => {
    const { name, verdict, reason } = fieldsOf(output);
    if (verdict !== "inconclusive" || typeof reason !== "string") {
      return [];
    }
    return [typeof name === "string" ? `${name}: ${reason}` : reason];
  });
}

function assertShown(shown: unknown, expected: unknown, whyInconclusive: string): void {
  try {
    assert.deepEqual(shown, expected);
  } catch (error) {
    if (whyInconclusive === "" || !(error instanceof assert.AssertionError)) {
      throw error;
    }
    throw new assert.AssertionError({ message: whyInconclusive, actual: shown, expected, operator: "deepStrictEqual" });
  }
}

function assertVerdicts(toolchain: Toolchain, output: Value, expected: readonly Fields[]): void {
  const verdicts = verdictsOf(output);
  assertShown(verdicts.map(shownVerdict), expected, toolchain.whyInconclusive(verdicts));
}

function assertTestResult(toolchain: Toolchain, output: Value, expected: Fields): void {
  assertShown(shownTestResult(output), expected, toolchain.whyInconclusive([output]));
}

function assertCases(toolchain: Toolchain, output: Value, expected: Cases | Fields): void {
  assertShown(shownCases(output), expected, toolchain.whyInconclusive([output]));
}

function lineOf(check: string): string {
  return `${check} wrote this line`;
}

function wantedChecks(
  checks: readonly string[],
  outcomes: Readonly<Record<string, CheckOutcome>>,
): readonly WantedCheck[] {
  return checks.map((name) => ({ name, outcome: outcomes[name] ?? "passes", line: lineOf(name) }));
}

function passed(name: string): Fields {
  return { name, verdict: "passed", lastLine: lineOf(name) };
}

function inconclusive(name: string): Fields {
  return { name, verdict: "inconclusive", reason: givenReason };
}

function notSetUp(name: string): Fields {
  return { name, reason: givenReason };
}

function allPassing(description: Description, testFiles: readonly WantedTestFile[]): Wanted {
  return { checks: wantedChecks(description.checks, {}), testRun: "set up", testFiles };
}

function isInsideTheFolder(path: string): boolean {
  const normalized = normalize(path);
  return !isAbsolute(path) && normalized !== ".." && !normalized.startsWith("../");
}

function globOf(pattern: string): RegExp {
  const parts = pattern.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === "**/") {
      return "(?:.*/)?";
    }
    if (part === "**") {
      return ".*";
    }
    return part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${parts.join("")}$`);
}

function matchedBy(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globOf(pattern).test(path));
}

function testFilesOf(description: Description, files: Files): readonly string[] {
  return Object.keys(files)
    .filter((path) => matchedBy(description.testFiles, path))
    .sort();
}

async function testFilesIn(toolchain: Toolchain, folder: string, wanted: Wanted): Promise<readonly string[]> {
  const description = await toolchain.describe();
  const files = testFilesOf(description, await toolchain.filesIn(folder));
  const why = "the checkout's test files, sorted by path, are the wanted test files in their order";
  assert.equal(files.length, wanted.testFiles.length, why);
  return files;
}

function failingTests(count: number): WantedTestFile {
  return Array.from({ length: count }, (_, index) => ({
    name: `failing case ${String(index + 1)}`,
    outcome: "fails",
    message: "it fails",
  }));
}

function namesOfTheFirst(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `failing case ${String(index + 1)}`);
}

async function timed<Result>(
  work: () => Promise<Result>,
): Promise<{ readonly result: Result; readonly seconds: number }> {
  const started = performance.now();
  const result = await work();
  return { result, seconds: (performance.now() - started) / 1000 };
}

const cases: readonly Case[] = [
  {
    name: "describe names a language, a practices file in the mode's own folder, and checks with distinct names, and runs nothing",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      assert.notEqual(description.language.trim(), "");
      assert.equal(isInsideTheFolder(description.practices), true, description.practices);
      const practices = join(toolchain.modeFolder(), description.practices);
      assert.equal(existsSync(practices), true, practices);
      assert.ok(description.checks.length > 0);
      assert.deepEqual([...new Set(description.checks)], description.checks);
      const run = await toolchain.describeRun();
      assert.deepEqual(
        run.events.filter((event) => event.kind === "command"),
        [],
      );
    },
  },
  {
    name: "describe's test files are the checkout's tests and lie within its source files",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const tested = await toolchain.write("two-test-files", allPassing(description, [sums, wrongSum]));
      const testFiles = testFilesOf(description, await toolchain.filesIn(tested));
      assert.equal(testFiles.length, 2, JSON.stringify(testFiles));
      assert.deepEqual(
        testFiles.filter((path) => !matchedBy(description.sourceFiles, path)),
        [],
      );
      const untested = await toolchain.write("no-test-files", allPassing(description, []));
      assert.deepEqual(testFilesOf(description, await toolchain.filesIn(untested)), []);
    },
  },
  {
    name: "describe says which checks and whether the test run the project is set up for, and what to add for the rest",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const [first = ""] = description.checks;
      const allNames = [...description.checks, testRunName];
      assert.deepEqual(
        { present: description.present, missing: description.missing },
        { present: [], missing: allNames.map(notSetUp) },
      );
      const partly = {
        checks: wantedChecks(description.checks, { [first]: "not set up" }),
        testRun: "not set up" as const,
        testFiles: [sums],
      };
      const removePartly = await toolchain.writeInTheRoot(partly);
      const described = await toolchain.describe();
      await removePartly();
      assert.deepEqual(
        { checks: described.checks, present: described.present, missing: described.missing },
        {
          checks: description.checks,
          present: description.checks.slice(1),
          missing: [notSetUp(first), notSetUp(testRunName)],
        },
      );
      const removeAll = await toolchain.writeInTheRoot(allPassing(description, [sums]));
      const whole = await toolchain.describe();
      await removeAll();
      assert.deepEqual({ present: whole.present, missing: whole.missing }, { present: allNames, missing: [] });
    },
  },
  {
    name: "a check the checkout is not set up for is inconclusive, and the checks after it still run",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const [first = ""] = description.checks;
      const wanted = {
        checks: wantedChecks(description.checks, { [first]: "not set up" }),
        testRun: "set up" as const,
        testFiles: [sums],
      };
      const folder = await toolchain.write("first-not-set-up", wanted);
      assertVerdicts(toolchain, await toolchain.check({ folder }), [
        inconclusive(first),
        ...description.checks.slice(1).map(passed),
      ]);
    },
  },
  {
    name: "a test run the checkout is not set up for is inconclusive, not passed",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const wanted = { ...allPassing(description, [sums]), testRun: "not set up" as const };
      const folder = await toolchain.write("test-not-set-up", wanted);
      assertTestResult(toolchain, await toolchain.test({ folder }), { verdict: "inconclusive", reason: givenReason });
    },
  },
  {
    name: "check with no checks named gives one verdict per check, in the order describe lists them",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("all-pass", allPassing(description, [sums]));
      assertVerdicts(toolchain, await toolchain.check({ folder }), description.checks.map(passed));
    },
  },
  {
    name: "a check that ends and finds something is failed, the end of its output says what, and the checks after it still run",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const [first = ""] = description.checks;
      const wanted = {
        checks: wantedChecks(description.checks, { [first]: "fails" }),
        testRun: "set up" as const,
        testFiles: [sums],
      };
      const folder = await toolchain.write("first-fails", wanted);
      assertVerdicts(toolchain, await toolchain.check({ folder }), [
        { name: first, verdict: "failed", lastLine: lineOf(first) },
        ...description.checks.slice(1).map(passed),
      ]);
    },
  },
  {
    name: "named checks are the only ones run, and their verdicts come in the order describe lists them",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const first = description.checks[0] ?? "";
      const last = description.checks[description.checks.length - 1] ?? "";
      const asked = [...new Set([last, first])];
      const others = description.checks.filter((name) => !asked.includes(name));
      const outcomes = Object.fromEntries(others.map((name): readonly [string, Outcome] => [name, "does not end"]));
      const folder = await toolchain.write("subset", {
        checks: wantedChecks(description.checks, outcomes),
        testRun: "set up",
        testFiles: [],
      });
      const { result, seconds } = await timed(() =>
        toolchain.check({ folder, checks: asked, timeLimitSeconds: waitedSeconds }),
      );
      assert.ok(seconds < waitedSeconds, String(seconds));
      assertVerdicts(toolchain, result, [...asked].reverse().map(passed));
    },
  },
  {
    name: "a check name that describe does not list is refused, and no check runs",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      assert.equal(description.checks.includes(unknownCheck), false);
      const first = description.checks[0] ?? "";
      const outcomes = Object.fromEntries(
        description.checks.map((name): readonly [string, Outcome] => [name, "does not end"]),
      );
      const folder = await toolchain.write("unknown-name", {
        checks: wantedChecks(description.checks, outcomes),
        testRun: "set up",
        testFiles: [],
      });
      const asked = { folder, checks: [first, unknownCheck], timeLimitSeconds: waitedSeconds };
      const { result, seconds } = await timed(() => toolchain.failure("check", asked));
      assert.notEqual(result.trim(), "");
      assert.ok(seconds < waitedSeconds, String(seconds));
    },
  },
  {
    name: "a check that does not end within its time limit is stopped and inconclusive, its time is reported, and the checks after it still run",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const [first = ""] = description.checks;
      const wanted = {
        checks: wantedChecks(description.checks, { [first]: "does not end" }),
        testRun: "set up" as const,
        testFiles: [],
      };
      const folder = await toolchain.write("first-does-not-end", wanted);
      const output = await toolchain.check({ folder, timeLimitSeconds: stopAfterSeconds });
      const seconds = secondsOf(verdictsOf(output)[0] ?? null);
      assert.ok(seconds >= stopAfterSeconds && seconds < stopAfterSeconds + waitedSeconds, String(seconds));
      assertVerdicts(toolchain, output, [inconclusive(first), ...description.checks.slice(1).map(passed)]);
    },
  },
  {
    name: "in a folder that does not exist every check could not be run, so each is inconclusive",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      assertVerdicts(toolchain, await toolchain.check({ folder: missingFolder }), description.checks.map(inconclusive));
    },
  },
  {
    name: "a test run where every test passes is passed, with the counts",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("tests-pass", allPassing(description, [sums, words]));
      assertTestResult(toolchain, await toolchain.test({ folder }), {
        verdict: "passed",
        passed: 3,
        failed: 0,
        failedTests: [],
      });
    },
  },
  {
    name: "a test run where one test fails is failed, with the counts and the name of the test that failed",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const wanted = allPassing(description, [sums, wrongSum]);
      const folder = await toolchain.write("one-test-fails", wanted);
      const [, file = ""] = await testFilesIn(toolchain, folder, wanted);
      assertTestResult(toolchain, await toolchain.test({ folder }), failedOnWrongSum(2, file));
    },
  },
  {
    name: "named test files are the only ones run",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const wanted = allPassing(description, [sums, wrongSum]);
      const folder = await toolchain.write("named-files", wanted);
      const outputs: Value[] = [];
      const files = await testFilesIn(toolchain, folder, wanted);
      for (const file of files) {
        outputs.push(await toolchain.test({ folder, files: [file] }));
      }
      const byVerdict = outputs
        .map(shownTestResult)
        .sort((left, right) => JSON.stringify(left.verdict).localeCompare(JSON.stringify(right.verdict)));
      const expected = [
        failedOnWrongSum(0, files[1] ?? ""),
        { verdict: "passed", passed: 2, failed: 0, failedTests: [] },
      ];
      assertShown(byVerdict, expected, toolchain.whyInconclusive(outputs));
    },
  },
  {
    name: "a test run that does not end within its time limit is stopped and inconclusive, and its time is reported",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("test-does-not-end", allPassing(description, [sums, waits]));
      const output = await toolchain.test({ folder, timeLimitSeconds: stopAfterSeconds });
      const seconds = secondsOf(output);
      assert.ok(seconds >= stopAfterSeconds && seconds < stopAfterSeconds + waitedSeconds, String(seconds));
      assertTestResult(toolchain, output, { verdict: "inconclusive", reason: givenReason });
    },
  },
  {
    name: "check and test accept a time limit of up to 1000 seconds and refuse 1001 before anything runs",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const longest = { folder: missingFolder, timeLimitSeconds: longestSeconds };
      assertVerdicts(toolchain, await toolchain.check(longest), description.checks.map(inconclusive));
      assertTestResult(toolchain, await toolchain.test(longest), { verdict: "inconclusive", reason: givenReason });
      const tooLong = { folder: missingFolder, timeLimitSeconds: longestSeconds + 1 };
      assert.deepEqual(
        [await toolchain.refusal("check", tooLong), await toolchain.refusal("test", tooLong)],
        [
          "input.timeLimitSeconds must be at most 1000, but it is 1001.",
          "input.timeLimitSeconds must be at most 1000, but it is 1001.",
        ],
      );
    },
  },
  {
    name: "a failed run lists each failing case with its file and the first line of its message that is not blank, and no case that passed",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const wanted = allPassing(description, [sums, twoWrongSums, wrongProduct]);
      const folder = await toolchain.write("failing-cases", wanted);
      const [, second = "", third = ""] = await testFilesIn(toolchain, folder, wanted);
      assertCases(toolchain, await toolchain.test({ folder }), {
        failures: [
          failingCase(wrongTwiceName, second, "the first sum is wrong"),
          failingCase(wrongTwiceName, second, "the second sum is wrong"),
          failingCase(wrongProductName, third, "the product is wrong"),
        ],
        failuresNotListed: 0,
        notLoaded: [],
      });
    },
  },
  {
    name: "a message's line is cut after 200 characters, and its case says how many were cut",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const lengths = [1, longestMessage - 1, longestMessage, longestMessage + 1, longestMessage + 2];
      const tests = lengths.map((length): WantedTest => ({
        name: `a message of ${String(length)} characters`,
        outcome: "fails",
        message: "m".repeat(length),
      }));
      const wanted = allPassing(description, [tests]);
      const folder = await toolchain.write("long-messages", wanted);
      const [file = ""] = await testFilesIn(toolchain, folder, wanted);
      assertCases(toolchain, await toolchain.test({ folder }), {
        failures: lengths.map((length) => ({
          name: `a message of ${String(length)} characters`,
          file,
          message: "m".repeat(Math.min(length, longestMessage)),
          charactersCut: Math.max(0, length - longestMessage),
        })),
        failuresNotListed: 0,
        notLoaded: [],
      });
    },
  },
  {
    name: "at most 50 failing cases are listed, the first in the order they ran, and the rest are counted",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const counts = [mostFailures - 1, mostFailures, mostFailures + 1, mostFailures + 2];
      const outputs: Value[] = [];
      for (const count of counts) {
        const folder = await toolchain.write(
          `${String(count)}-failing`,
          allPassing(description, [failingTests(count)]),
        );
        outputs.push(await toolchain.test({ folder }));
      }
      const shown = outputs.map((output) => {
        const fields = fieldsOf(output);
        shownTestResult(output);
        const { failures, failuresNotListed } = casesOf(fields);
        return { names: failures.map((failure) => failure.name), failuresNotListed };
      });
      const expected = counts.map((count) => ({
        names: namesOfTheFirst(Math.min(count, mostFailures)),
        failuresNotListed: Math.max(0, count - mostFailures),
      }));
      assertShown(shown, expected, toolchain.whyInconclusive(outputs));
    },
  },
  {
    name: "two failing cases with the same name in different files are two cases, each with its own file and message",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const inFile = (message: string): WantedTestFile => [{ name: wrongSumName, outcome: "fails", message }];
      const wanted = allPassing(description, [inFile("the first file's sum"), inFile("the second file's sum")]);
      const folder = await toolchain.write("same-name", wanted);
      const [first = "", second = ""] = await testFilesIn(toolchain, folder, wanted);
      assertCases(toolchain, await toolchain.test({ folder }), {
        failures: [
          failingCase(wrongSumName, first, "the first file's sum"),
          failingCase(wrongSumName, second, "the second file's sum"),
        ],
        failuresNotListed: 0,
        notLoaded: [],
      });
    },
  },
  {
    name: "a test file that does not load is named in notLoaded and is no failing case, and the failing cases of the other files are still listed",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const wanted = allPassing(description, [[...sums, ...wrongSum], "does not load"]);
      const folder = await toolchain.write("one-does-not-load", wanted);
      const [first = "", second = ""] = await testFilesIn(toolchain, folder, wanted);
      assertCases(toolchain, await toolchain.test({ folder }), {
        failures: [failingCase(wrongSumName, first, wrongSumMessage)],
        failuresNotListed: 0,
        notLoaded: [second],
      });
    },
  },
  {
    name: "a run whose cases all pass but whose test files do not all load is failed, with no failing case and each file that did not load",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const wanted = allPassing(description, [sums, "does not load", "does not load"]);
      const folder = await toolchain.write("two-do-not-load", wanted);
      const [, second = "", third = ""] = await testFilesIn(toolchain, folder, wanted);
      const output = await toolchain.test({ folder });
      assertShown(
        { verdict: fieldsOf(output).verdict ?? null, ...shownCases(output) },
        { verdict: "failed", failures: [], failuresNotListed: 0, notLoaded: [second, third] },
        toolchain.whyInconclusive([output]),
      );
    },
  },
  {
    name: "a test run with no tests is inconclusive, not passed",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("no-tests", allPassing(description, []));
      assertTestResult(toolchain, await toolchain.test({ folder }), {
        verdict: "inconclusive",
        reason: givenReason,
      });
    },
  },
  {
    name: "a test run in a folder that does not exist could not be run, so it is inconclusive",
    run: async (toolchain) => {
      assertTestResult(toolchain, await toolchain.test({ folder: missingFolder }), {
        verdict: "inconclusive",
        reason: givenReason,
      });
    },
  },
  {
    name: "check and test write nothing outside the folder they are given, anywhere in the project",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("written-only-inside", allPassing(description, [sums, wrongSum]));
      await toolchain.check({ folder });
      await toolchain.test({ folder });
      assert.deepEqual(await toolchain.projectOutsideTheFolders(), toolchain.projectAsOpened);
    },
  },
  {
    name: "a second check and test on the same folder, after the first wrote there, give the same verdicts",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const [first = ""] = description.checks;
      const wanted = {
        checks: wantedChecks(description.checks, { [first]: "fails" }),
        testRun: "set up" as const,
        testFiles: [sums, wrongSum],
      };
      const folder = await toolchain.write("called-twice", wanted);
      const [, file = ""] = await testFilesIn(toolchain, folder, wanted);
      const expected = {
        verdicts: [
          { name: first, verdict: "failed", lastLine: lineOf(first) },
          ...description.checks.slice(1).map(passed),
        ],
        test: failedOnWrongSum(2, file),
      };
      for (const call of ["first", "second"]) {
        const verdicts = verdictsOf(await toolchain.check({ folder }));
        const test = await toolchain.test({ folder });
        const shown = { call, verdicts: verdicts.map(shownVerdict), test: shownTestResult(test) };
        assertShown(shown, { call, ...expected }, toolchain.whyInconclusive([...verdicts, test]));
      }
    },
  },
];

async function filesUnder(root: string, folder: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      Object.assign(found, await filesUnder(root, path));
    } else {
      found[relative(root, path)] = await readFile(path, "utf8");
    }
  }
  return found;
}

type Setting = {
  readonly index: number;
  readonly foldersSetAside: Set<string>;
  readonly asOpened: Files;
};

function isKernelDatabase(path: string): boolean {
  return path.startsWith(`${kernelStateFolder}/`) && kernelDatabase.test(path);
}

async function entriesOutside(root: string, folder: string, skipped: ReadonlySet<string>): Promise<Files> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    const shown = relative(root, path);
    if (skipped.has(path) || isKernelDatabase(shown)) {
      continue;
    }
    if (entry.isDirectory()) {
      found[`${shown}/`] = "";
      Object.assign(found, await entriesOutside(root, path, skipped));
    } else {
      found[shown] = await readFile(path, "utf8");
    }
  }
  return found;
}

async function writeFilesIn(folder: string, files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(folder, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

function modeFolderOf(project: ModeProject, mode: string): string {
  const candidates = [
    join(kit, "components", "base", mode),
    join(kit, "components", "modes", mode),
    join(project.root, "components", "modes", mode),
  ];
  const found = candidates.filter((folder) => existsSync(join(folder, "mode.yaml")));
  assert.equal(found.length, 1, JSON.stringify(found));
  return found[0] ?? "";
}

function toolchainFor(project: ModeProject, underTest: ToolchainUnderTest, setting: Setting): Toolchain {
  const reference = (action: string): string => `${underTest.mode}.${action}`;
  const given = (input: Fields): Fields => {
    if (typeof input.folder === "string") {
      setting.foldersSetAside.add(resolve(project.root, input.folder));
    }
    return input;
  };
  return {
    describe: async () => descriptionOf(await project.output(reference("describe"), {})),
    describeRun: () => project.run(reference("describe"), {}),
    check: (input) => project.output(reference("check"), { timeLimitSeconds: checkSeconds, ...given(input) }),
    test: (input) => project.output(reference("test"), { timeLimitSeconds: testSeconds, ...given(input) }),
    failure: (action, input) => project.failure(reference(action), given(input)),
    refusal: (action, input) => project.refusal(reference(action), given(input)),
    whyInconclusive: (outputs) => {
      const reasons = reasonsGiven(outputs);
      if (reasons.length === 0) {
        return "";
      }
      const lines = ["The toolchain gave these reasons for its inconclusive verdicts:", ...reasons];
      const untrusted = project.untrustedSentence(reference("check"));
      return [...lines, ...(untrusted === "" ? [] : [untrusted])].join("\n");
    },
    write: async (label, wanted) => {
      const folder = join(checkoutsFolder, `case-${String(setting.index + 1)}-${label}`);
      setting.foldersSetAside.add(join(project.root, folder));
      await writeFilesIn(join(project.root, folder), underTest.checkout(wanted));
      return folder;
    },
    writeInTheRoot: async (wanted) => {
      const files = underTest.checkout(wanted);
      const topLevel = [...new Set(Object.keys(files).map((path) => path.split("/")[0] ?? path))];
      const present = topLevel.filter((name) => existsSync(join(project.root, name)));
      assert.deepEqual(present, [], "the project's root already holds these");
      await writeFilesIn(project.root, files);
      return async () => {
        for (const name of topLevel) {
          await rm(join(project.root, name), { recursive: true, force: true });
        }
      };
    },
    modeFolder: () => modeFolderOf(project, underTest.mode),
    filesIn: (folder) => filesUnder(join(project.root, folder), join(project.root, folder)),
    projectOutsideTheFolders: () => entriesOutside(project.root, project.root, setting.foldersSetAside),
    projectAsOpened: setting.asOpened,
  };
}

export function testToolchain(underTest: ToolchainUnderTest, testProject: TestProject = {}): void {
  const { mode } = underTest;
  const foldersSetAside = new Set<string>();
  let project: ModeProject;
  let asOpened: Files;
  before(async () => {
    project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: [mode] }, testProject);
    await mkdir(join(project.root, checkoutsFolder));
    asOpened = await entriesOutside(project.root, project.root, foldersSetAside);
  });
  after(async () => {
    await project.close();
  });
  for (const [index, entry] of cases.entries()) {
    test(`${interfaceName}@1, ${mode}: ${entry.name}`, async () => {
      await entry.run(toolchainFor(project, underTest, { index, foldersSetAside, asOpened }));
    });
  }
}
