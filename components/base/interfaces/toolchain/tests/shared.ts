import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { openModeProject, type ModeProject, type ProjectFolder } from "../../../../../tests/test-toolbox.ts";

export type Files = Readonly<Record<string, string>>;

export type Outcome = "passes" | "fails" | "does not end";

export type WantedCheck = {
  readonly name: string;
  readonly outcome: Outcome;
  readonly line: string;
};

export type WantedTest = {
  readonly name: string;
  readonly outcome: Outcome;
};

export type WantedTestFile = readonly WantedTest[];

export type Wanted = {
  readonly checks: readonly WantedCheck[];
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
};

type Toolchain = {
  readonly describe: () => Promise<Description>;
  readonly describeRun: () => ReturnType<ModeProject["run"]>;
  readonly check: (input: Fields) => Promise<Value>;
  readonly test: (input: Fields) => Promise<Value>;
  readonly failure: (action: string, input: Fields) => Promise<string>;
  readonly write: (label: string, wanted: Wanted) => Promise<string>;
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

const stopAfterSeconds = 2;

const waitedSeconds = 30;

const unknownCheck = "no-such-check";

const checkoutsFolder = "checkouts";

const missingFolder = join(checkoutsFolder, "nowhere");

const givenReason = "a reason is given";

const kernelStateFolder = ".agentbay";

const kernelDatabase = /\.db(-wal|-shm|-journal)?$/;

const sums: WantedTestFile = [
  { name: "one and one make two", outcome: "passes" },
  { name: "two and two make four", outcome: "passes" },
];

const words: WantedTestFile = [{ name: "a word has letters", outcome: "passes" }];

const wrongSum: WantedTestFile = [{ name: "a sum that is wrong", outcome: "fails" }];

const waits: WantedTestFile = [{ name: "waits for ever", outcome: "does not end" }];

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

function descriptionOf(value: Value): Description {
  const fields = fieldsOf(value);
  return {
    language: textOf(fields.language),
    sourceFiles: textsOf(fields.sourceFiles),
    testFiles: textsOf(fields.testFiles),
    practices: textOf(fields.practices),
    checks: textsOf(fields.checks),
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
  assert.deepEqual(keysOf(value), ["failed", "failedTests", "passed", "seconds", "stderr", "stdout", "verdict"]);
  return { verdict: verdict ?? null, passed: passed ?? null, failed: failed ?? null, failedTests: failedTests ?? null };
}

function verdictsOf(output: Value): readonly Value[] {
  const verdicts = fieldsOf(output).verdicts;
  assert.ok(isList(verdicts), JSON.stringify(output));
  return verdicts;
}

function lineOf(check: string): string {
  return `${check} wrote this line`;
}

function wantedChecks(checks: readonly string[], outcomes: Readonly<Record<string, Outcome>>): readonly WantedCheck[] {
  return checks.map((name) => ({ name, outcome: outcomes[name] ?? "passes", line: lineOf(name) }));
}

function passed(name: string): Fields {
  return { name, verdict: "passed", lastLine: lineOf(name) };
}

function inconclusive(name: string): Fields {
  return { name, verdict: "inconclusive", reason: givenReason };
}

function allPassing(description: Description, testFiles: readonly WantedTestFile[]): Wanted {
  return { checks: wantedChecks(description.checks, {}), testFiles };
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

async function timed<Result>(
  work: () => Promise<Result>,
): Promise<{ readonly result: Result; readonly seconds: number }> {
  const started = performance.now();
  const result = await work();
  return { result, seconds: (performance.now() - started) / 1000 };
}

const cases: readonly Case[] = [
  {
    name: "describe names a language, a practices file in the kit, and checks with distinct names, and runs nothing",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      assert.notEqual(description.language.trim(), "");
      assert.equal(existsSync(join(kit, description.practices)), true, description.practices);
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
    name: "check with no checks named gives one verdict per check, in the order describe lists them",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("all-pass", allPassing(description, [sums]));
      const verdicts = verdictsOf(await toolchain.check({ folder }));
      assert.deepEqual(verdicts.map(shownVerdict), description.checks.map(passed));
    },
  },
  {
    name: "a check that ends and finds something is failed, the end of its output says what, and the checks after it still run",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const [first = ""] = description.checks;
      const wanted = { checks: wantedChecks(description.checks, { [first]: "fails" }), testFiles: [sums] };
      const folder = await toolchain.write("first-fails", wanted);
      const verdicts = verdictsOf(await toolchain.check({ folder }));
      assert.deepEqual(verdicts.map(shownVerdict), [
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
        testFiles: [],
      });
      const { result, seconds } = await timed(() =>
        toolchain.check({ folder, checks: asked, timeLimitSeconds: waitedSeconds }),
      );
      assert.ok(seconds < waitedSeconds, String(seconds));
      assert.deepEqual(verdictsOf(result).map(shownVerdict), [...asked].reverse().map(passed));
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
      const wanted = { checks: wantedChecks(description.checks, { [first]: "does not end" }), testFiles: [] };
      const folder = await toolchain.write("first-does-not-end", wanted);
      const verdicts = verdictsOf(await toolchain.check({ folder, timeLimitSeconds: stopAfterSeconds }));
      const seconds = secondsOf(verdicts[0] ?? null);
      assert.ok(seconds >= stopAfterSeconds && seconds < stopAfterSeconds + waitedSeconds, String(seconds));
      assert.deepEqual(verdicts.map(shownVerdict), [inconclusive(first), ...description.checks.slice(1).map(passed)]);
    },
  },
  {
    name: "in a folder that does not exist every check could not be run, so each is inconclusive",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const verdicts = verdictsOf(await toolchain.check({ folder: missingFolder }));
      assert.deepEqual(verdicts.map(shownVerdict), description.checks.map(inconclusive));
    },
  },
  {
    name: "a test run where every test passes is passed, with the counts",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("tests-pass", allPassing(description, [sums, words]));
      assert.deepEqual(shownTestResult(await toolchain.test({ folder })), {
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
      const folder = await toolchain.write("one-test-fails", allPassing(description, [sums, wrongSum]));
      assert.deepEqual(shownTestResult(await toolchain.test({ folder })), {
        verdict: "failed",
        passed: 2,
        failed: 1,
        failedTests: ["a sum that is wrong"],
      });
    },
  },
  {
    name: "named test files are the only ones run",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("named-files", allPassing(description, [sums, wrongSum]));
      const results: Fields[] = [];
      for (const file of testFilesOf(description, await toolchain.filesIn(folder))) {
        results.push(shownTestResult(await toolchain.test({ folder, files: [file] })));
      }
      const byVerdict = [...results].sort((left, right) =>
        JSON.stringify(left.verdict).localeCompare(JSON.stringify(right.verdict)),
      );
      assert.deepEqual(byVerdict, [
        { verdict: "failed", passed: 0, failed: 1, failedTests: ["a sum that is wrong"] },
        { verdict: "passed", passed: 2, failed: 0, failedTests: [] },
      ]);
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
      assert.deepEqual(shownTestResult(output), { verdict: "inconclusive", reason: givenReason });
    },
  },
  {
    name: "a test run with no tests is inconclusive, not passed",
    run: async (toolchain) => {
      const description = await toolchain.describe();
      const folder = await toolchain.write("no-tests", allPassing(description, []));
      assert.deepEqual(shownTestResult(await toolchain.test({ folder })), {
        verdict: "inconclusive",
        reason: givenReason,
      });
    },
  },
  {
    name: "a test run in a folder that does not exist could not be run, so it is inconclusive",
    run: async (toolchain) => {
      assert.deepEqual(shownTestResult(await toolchain.test({ folder: missingFolder })), {
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
      const wanted = { checks: wantedChecks(description.checks, { [first]: "fails" }), testFiles: [sums, wrongSum] };
      const folder = await toolchain.write("called-twice", wanted);
      const expected = {
        verdicts: [
          { name: first, verdict: "failed", lastLine: lineOf(first) },
          ...description.checks.slice(1).map(passed),
        ],
        test: { verdict: "failed", passed: 2, failed: 1, failedTests: ["a sum that is wrong"] },
      };
      for (const call of ["first", "second"]) {
        const verdicts = verdictsOf(await toolchain.check({ folder })).map(shownVerdict);
        const test = shownTestResult(await toolchain.test({ folder }));
        assert.deepEqual({ call, verdicts, test }, { call, ...expected });
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
    write: async (label, wanted) => {
      const folder = join(checkoutsFolder, `case-${String(setting.index + 1)}-${label}`);
      setting.foldersSetAside.add(join(project.root, folder));
      for (const [path, text] of Object.entries(underTest.checkout(wanted))) {
        const file = join(project.root, folder, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, text, "utf8");
      }
      return folder;
    },
    filesIn: (folder) => filesUnder(join(project.root, folder), join(project.root, folder)),
    projectOutsideTheFolders: () => entriesOutside(project.root, project.root, setting.foldersSetAside),
    projectAsOpened: setting.asOpened,
  };
}

export function testToolchain(underTest: ToolchainUnderTest, projectFolder: ProjectFolder = {}): void {
  const { mode } = underTest;
  const foldersSetAside = new Set<string>();
  let project: ModeProject;
  let asOpened: Files;
  before(async () => {
    project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: [mode] }, projectFolder);
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
