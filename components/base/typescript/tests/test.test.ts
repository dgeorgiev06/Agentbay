import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  commandsRun,
  openToolchainProject,
  packageWith,
  printing,
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

const testScript = { test: "node --test" };

const sums = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'test("one and one make two", () => assert.equal(1 + 1, 2));',
  'test("two and two make four", () => assert.equal(2 + 2, 4));',
  "",
].join("\n");

const words = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'test("a word has letters", () => assert.ok("word".length > 0));',
  "",
].join("\n");

const hangingTest = [
  'import { test } from "node:test";',
  'test("waits for ever", () => new Promise((done) => setTimeout(done, 600000)));',
  "",
].join("\n");

async function checkoutWith(name: string, files: Files): Promise<string> {
  return writeCheckout(project, name, { "package.json": packageWith(testScript), ...files });
}

function shownResult(output: Json): Fields {
  const { stdout, stderr, ...rest } = withoutSeconds(output);
  assert.equal(typeof stdout, "string");
  assert.equal(typeof stderr, "string");
  return rest;
}

async function tested(input: object): Promise<Fields> {
  return shownResult(await project.output("typescript.test", { timeLimitSeconds: 60, ...input }));
}

test("test runs npm test with the TAP reporter, followed by the named test files", async () => {
  const files = { "tests/sums.test.ts": sums, "tests/words.test.ts": words };
  const folder = await checkoutWith("named", files);
  const run = await project.run("typescript.test", { folder, files: ["tests/sums.test.ts", "tests/words.test.ts"] });
  assert.deepEqual(commandsRun(run.events), [
    ["cat", "--", "package.json"],
    ["npm", "test", "--", "--test-reporter=tap", "tests/sums.test.ts", "tests/words.test.ts"],
  ]);
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  assert.deepEqual(shownResult(run.state.output), { verdict: "passed", passed: 3, failed: 0, failedTests: [] });
});

test("the mode's sentences for a test run stopped at its limit and a run that reports no tests", async () => {
  const folder = await checkoutWith("hangs", { "tests/waits.test.ts": hangingTest });
  assert.deepEqual(await tested({ folder, timeLimitSeconds: 3 }), {
    verdict: "inconclusive",
    reason: "The test run did not finish within 3 seconds and was stopped.",
  });
  const empty = await checkoutWith("no-tests", { "src/sums.ts": "export const two = 2;\n" });
  assert.deepEqual(await tested({ folder: empty }), {
    verdict: "inconclusive",
    reason: "The run reported no tests, so nothing was tested.",
  });
});

test("a run whose output has no summary of the tests is inconclusive", async () => {
  const folder = await writeCheckout(project, "no-summary", {
    "package.json": packageWith({ test: printing("all good") }),
  });
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason: "The output ended without a summary of the tests, so the mode cannot tell whether they passed.",
  });
});

test("a checkout without a test script, or whose package.json is not JSON, is inconclusive with what to add, and npm is not run", async () => {
  const folder = await writeCheckout(project, "no-script", { "package.json": packageWith({}) });
  const run = await project.run("typescript.test", { folder });
  assert.deepEqual(commandsRun(run.events), [["cat", "--", "package.json"]]);
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  assert.deepEqual(shownResult(run.state.output), {
    verdict: "inconclusive",
    reason:
      'The checkout\'s package.json has no script test: add "test": "node --test" to its scripts, ' +
      "or another command that runs the tests with node's test runner.",
  });
  const broken = await writeCheckout(project, "test-not-json", { "package.json": "test: node --test\n" });
  assert.deepEqual(await tested({ folder: broken }), {
    verdict: "inconclusive",
    reason:
      "The checkout's package.json is not JSON, so the mode cannot tell whether it has the script test: " +
      'make it JSON, with "test": "node --test" in its scripts, ' +
      "or another command that runs the tests with node's test runner.",
  });
});

const summaryPrinter = [
  "const [tests, pass, fail, cancelled, exitCode] = process.argv.slice(2).map(Number);",
  "const lines = [`tests ${tests}`, `pass ${pass}`, `fail ${fail}`, `cancelled ${cancelled}`];",
  "console.log(lines.map((line) => `# ${line}`).join('\\n'));",
  "process.exitCode = exitCode;",
  "",
].join("\n");

async function summaryCheckout(name: string, printed: string): Promise<string> {
  return writeCheckout(project, name, {
    "package.json": packageWith({ test: `node summary.mjs ${printed}` }),
    "summary.mjs": summaryPrinter,
  });
}

test("a run whose summary says every test passed but whose exit code is not 0 is inconclusive", async () => {
  const folder = await summaryCheckout("passed-but-exit-3", "2 2 0 0 3");
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason:
      "The test run ended with exit code 3, 2 passed, 0 failed and 0 cancelled, " +
      "which the mode does not read as passed or failed.",
  });
});

test("a run that ends with exit code 0 but reports a cancelled test is inconclusive", async () => {
  const folder = await summaryCheckout("cancelled-exit-0", "2 1 0 1 0");
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason:
      "The test run ended with exit code 0, 1 passed, 0 failed and 1 cancelled, " +
      "which the mode does not read as passed or failed.",
  });
});

test("a run that ends with exit code 0 but reports a failed test is inconclusive, not passed", async () => {
  const folder = await summaryCheckout("failed-exit-0", "2 1 1 0 0");
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason:
      "The test run ended with exit code 0, 1 passed, 1 failed and 0 cancelled, " +
      "which the mode does not read as passed or failed.",
  });
});

test("a test that runs past its own time limit is cancelled, which is inconclusive, not passed", async () => {
  const slow = [
    'import { test } from "node:test";',
    'test("slow", { timeout: 50 }, () => new Promise((done) => setTimeout(done, 1000)));',
    "",
  ].join("\n");
  const folder = await checkoutWith("cancelled", { "tests/sums.test.ts": sums, "tests/slow.test.ts": slow });
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason:
      "The test run ended with exit code 1, 2 passed, 0 failed and 1 cancelled, " +
      "which the mode does not read as passed or failed.",
  });
});

test("lines a test prints that look like the summary do not change the counts", async () => {
  const printing = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'test("prints a summary of its own", () => console.log("tests 0\\npass 0\\nfail 0\\ncancelled 0"));',
    'test("a sum that is wrong", () => assert.equal(1 + 1, 3));',
    "",
  ].join("\n");
  const folder = await checkoutWith("prints-summary", { "tests/prints.test.ts": printing });
  assert.deepEqual(await tested({ folder }), {
    verdict: "failed",
    passed: 1,
    failed: 1,
    failedTests: ["a sum that is wrong"],
    failures: [
      {
        name: "a sum that is wrong",
        file: "tests/prints.test.ts",
        message: "Expected values to be strictly equal:",
        charactersCut: 0,
      },
    ],
    failuresNotListed: 0,
    notLoaded: [],
  });
});

test("a failing test marked to do is not named among the failed, and a # in a name is kept", async () => {
  const marked = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'test("later # maybe", { todo: true }, () => assert.equal(1, 2));',
    'test("sum # 3 is wrong", () => assert.equal(1 + 1, 3));',
    'test("one and one make two", () => assert.equal(1 + 1, 2));',
    "",
  ].join("\n");
  const folder = await checkoutWith("todo", { "tests/marked.test.ts": marked });
  assert.deepEqual(await tested({ folder }), {
    verdict: "failed",
    passed: 1,
    failed: 1,
    failedTests: ["sum # 3 is wrong"],
    failures: [
      {
        name: "sum # 3 is wrong",
        file: "tests/marked.test.ts",
        message: "Expected values to be strictly equal:",
        charactersCut: 0,
      },
    ],
    failuresNotListed: 0,
    notLoaded: [],
  });
});

test("a run where every test was skipped is inconclusive, not passed", async () => {
  const skipped = ['import { test } from "node:test";', 'test("skipped", { skip: true }, () => {});', ""].join("\n");
  const folder = await checkoutWith("all-skipped", { "tests/skipped.test.ts": skipped });
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason:
      "The test run ended with exit code 0, 0 passed, 0 failed and 0 cancelled, " +
      "which the mode does not read as passed or failed.",
  });
});
