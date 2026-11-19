import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  commandsRun,
  listed,
  openToolchainProject,
  packageWith,
  withoutSeconds,
  writeCheckout,
  type Fields,
  type Files,
} from "./checkouts.ts";

let project: ModeProject;

before(async () => {
  project = await openToolchainProject();
});

after(async () => {
  await project.close();
});

const messages = [
  'import assert from "node:assert/strict";',
  'import { describe, test } from "node:test";',
  'test("a sum that is wrong", () => assert.equal(1 + 1, 3));',
  'test("an expression that is false", () => assert.ok(1 + 1 === 3));',
  'test("objects that differ", () => assert.deepEqual({ total: 2 }, { total: 3 }));',
  'test("a message of its own", () => assert.equal(1 + 1, 3, "the sum should be three"));',
  'test("an error of several lines", () => { throw new Error("\\n  first words  \\nsecond words"); });',
  'test("quotes of every kind", () => { throw new Error("it\'s \\"so\\" `here` \\\\ too"); });',
  'test("a long message", () => { throw new Error("é".repeat(150) + "😀".repeat(100)); });',
  'test("a very long message", () => { throw new Error("y".repeat(20000)); });',
  'test("an empty message", () => { throw new Error(""); });',
  'describe("a group", () => { test("a case in a group", () => assert.fail("the case in the group fails")); });',
  'describe("a group that throws", () => { throw new Error("the group\'s own code fails"); });',
  'test("later", { todo: true }, () => assert.fail("not yet"));',
  'test("one and one make two", () => assert.equal(1 + 1, 2));',
  "",
].join("\n");

const doesNotParse = [
  'import { test } from "node:test";',
  "const total: = 3;",
  'test("never runs", () => {});',
  "",
].join("\n");

const importsWhatIsMissing = [
  'import { test } from "node:test";',
  'import "./missing.ts";',
  'test("never runs", () => {});',
  "",
].join("\n");

const stopsAfterItsCase = [
  'import { test } from "node:test";',
  'test("a case that passes before the file stops", () => {});',
  'throw new Error("the file stops here");',
  "",
].join("\n");

const messagesFile = "tests/messages.test.ts";

function failingCase(name: string, file: string, message: string): Fields {
  return { name, file, message, charactersCut: 0 };
}

function fileOf(failure: Json): string {
  const file: unknown = typeof failure === "object" && failure !== null ? Reflect.get(failure, "file") : undefined;
  return typeof file === "string" ? file : "";
}

function shownCases(output: Json): Fields {
  const { verdict, failuresNotListed, notLoaded } = withoutSeconds(output);
  const failures = [...listed(output, "failures")].sort((left, right) => fileOf(left).localeCompare(fileOf(right)));
  return {
    verdict: verdict ?? null,
    failures,
    failuresNotListed: failuresNotListed ?? null,
    notLoaded: notLoaded ?? null,
  };
}

async function testedIn(name: string, files: Files): Promise<Json> {
  const folder = await writeCheckout(project, name, { "package.json": packageWith({ test: "node --test" }), ...files });
  return project.output("typescript.test", { folder, timeLimitSeconds: 60 });
}

test("each failing case is its name, its file and the first line of node's message that is not blank, cut after 200 characters and counted, with no source, stack, location, expected or actual value", async () => {
  const output = await testedIn("messages", { [messagesFile]: messages });
  assert.deepEqual(shownCases(output), {
    verdict: "failed",
    failures: [
      failingCase("a sum that is wrong", messagesFile, "Expected values to be strictly equal:"),
      failingCase("an expression that is false", messagesFile, "The expression evaluated to a falsy value:"),
      failingCase("objects that differ", messagesFile, "Expected values to be strictly deep-equal:"),
      failingCase("a message of its own", messagesFile, "the sum should be three"),
      failingCase("an error of several lines", messagesFile, "first words"),
      failingCase("quotes of every kind", messagesFile, 'it\'s "so" `here` \\ too'),
      {
        name: "a long message",
        file: messagesFile,
        message: "é".repeat(150) + "😀".repeat(50),
        charactersCut: 50,
      },
      { name: "a very long message", file: messagesFile, message: "y".repeat(200), charactersCut: 19800 },
      failingCase("an empty message", messagesFile, ""),
      failingCase("a case in a group", messagesFile, "the case in the group fails"),
      failingCase("a group that throws", messagesFile, "the group's own code fails"),
    ],
    failuresNotListed: 0,
    notLoaded: [],
  });
});

test("a test file that does not parse, imports what is missing, or stops outside its cases is named in notLoaded and is no failing case", async () => {
  const output = await testedIn("not-loaded", {
    "tests/does-not-parse.test.ts": doesNotParse,
    "tests/imports-what-is-missing.test.ts": importsWhatIsMissing,
    "tests/stops-after-its-case.test.ts": stopsAfterItsCase,
  });
  const shown = shownCases(output);
  assert.deepEqual(
    { ...shown, passed: withoutSeconds(output).passed ?? null, notLoaded: [...listOf(shown.notLoaded)].sort() },
    {
      passed: 1,
      verdict: "failed",
      failures: [],
      failuresNotListed: 0,
      notLoaded: [
        "tests/does-not-parse.test.ts",
        "tests/imports-what-is-missing.test.ts",
        "tests/stops-after-its-case.test.ts",
      ],
    },
  );
});

function listOf(value: Json | undefined): readonly string[] {
  assert.ok(Array.isArray(value), JSON.stringify(value));
  return value.filter((item) => typeof item === "string");
}

const printedRun = String.raw`TAP version 13
# Subtest: a case before the file stopped
not ok 1 - a case before the file stopped
  ---
  type: 'test'
  location: '{folder}/tests/stops.test.ts:3:1'
  failureType: 'testCodeFailure'
  error: 'the case fails'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    TestContext.<anonymous> (file://{folder}/tests/stops.test.ts:3:33)
  ...
# Subtest: tests/stops.test.ts
not ok 2 - tests/stops.test.ts
  ---
  type: 'test'
  location: '{folder}/tests/stops.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: a parent
    # Subtest: a case declared outside the checkout
    not ok 1 - a case declared outside the checkout
      ---
      location: '/elsewhere/helper.ts:9:1'
      error: |-
        it fails elsewhere
        expected: 3
      ...
    1..1
not ok 3 - a parent
  ---
  location: '{folder}/tests/parent.test.ts:2:1'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  ...
# Subtest: a case with no location
not ok 4 - a case with no location
  ---
  error: "it's nowhere"
  ...
1..4
# tests 4
# suites 0
# pass 0
# fail 4
# cancelled 0
`;

const printer = [
  'import { readFileSync } from "node:fs";',
  'process.stdout.write(readFileSync("run.tap", "utf8").replaceAll("{folder}", process.cwd()));',
  "process.exitCode = 1;",
  "",
].join("\n");

test("a failing case in a file that also stopped is kept, a case outside the folder keeps node's path, one with no location has no file, and a parent that failed only by its cases is none", async () => {
  const folder = await writeCheckout(project, "printed", {
    "package.json": packageWith({ test: "node print.mjs" }),
    "print.mjs": printer,
    "run.tap": printedRun,
  });
  const run = await project.run("typescript.test", { folder, timeLimitSeconds: 60 });
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  assert.deepEqual(commandsRun(run.events), [
    ["cat", "--", "package.json"],
    ["npm", "test", "--", "--test-reporter=tap"],
    ["pwd", "-P"],
  ]);
  const { stdout, stderr, ...answer } = withoutSeconds(run.state.output);
  assert.deepEqual(
    answer,
    {
      verdict: "failed",
      passed: 0,
      failed: 4,
      failedTests: [
        "a case before the file stopped",
        "tests/stops.test.ts",
        "a case declared outside the checkout",
        "a parent",
        "a case with no location",
      ],
      failures: [
        failingCase("a case before the file stopped", "tests/stops.test.ts", "the case fails"),
        failingCase("a case declared outside the checkout", "/elsewhere/helper.ts", "it fails elsewhere"),
        failingCase("a case with no location", "", "it's nowhere"),
      ],
      failuresNotListed: 0,
      notLoaded: ["tests/stops.test.ts"],
    },
    JSON.stringify({ stdout, stderr }),
  );
});
