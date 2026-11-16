import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import type { ModeProject } from "../../../../tests/mode-harness.ts";
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

const wrongSum = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'test("a sum that is wrong", () => assert.equal(1 + 1, 3));',
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

test("a run where every test passes is passed, with the counts", async () => {
  const folder = await checkoutWith("all-pass", { "tests/sums.test.ts": sums, "tests/words.test.ts": words });
  assert.deepEqual(await tested({ folder }), { verdict: "passed", passed: 3, failed: 0, failedTests: [] });
});

test("a run where one test fails is failed, with the counts and the name of the test that failed", async () => {
  const folder = await checkoutWith("one-fails", { "tests/sums.test.ts": sums, "tests/wrong.test.ts": wrongSum });
  assert.deepEqual(await tested({ folder }), {
    verdict: "failed",
    passed: 2,
    failed: 1,
    failedTests: ["a sum that is wrong"],
  });
});

test("named test files are the only ones run", async () => {
  const files = { "tests/sums.test.ts": sums, "tests/wrong.test.ts": wrongSum, "tests/words.test.ts": words };
  const folder = await checkoutWith("named", files);
  const run = await project.run("typescript.test", { folder, files: ["tests/sums.test.ts", "tests/words.test.ts"] });
  assert.deepEqual(commandsRun(run.events), [
    ["npm", "test", "--", "--test-reporter=tap", "tests/sums.test.ts", "tests/words.test.ts"],
  ]);
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  assert.deepEqual(shownResult(run.state.output), { verdict: "passed", passed: 3, failed: 0, failedTests: [] });
});

test("a test run that does not finish within its time limit is stopped and inconclusive", async () => {
  const folder = await checkoutWith("hangs", { "tests/sums.test.ts": sums, "tests/waits.test.ts": hangingTest });
  assert.deepEqual(await tested({ folder, timeLimitSeconds: 3 }), {
    verdict: "inconclusive",
    reason: "The test run did not finish within 3 seconds and was stopped.",
  });
});

test("a run that reports no tests at all is inconclusive, not passed", async () => {
  const folder = await checkoutWith("no-tests", { "src/sums.ts": "export const two = 2;\n" });
  assert.deepEqual(await tested({ folder }), {
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

test("a checkout without a test script cannot be started and is inconclusive", async () => {
  const folder = await writeCheckout(project, "no-script", { "package.json": packageWith({}) });
  assert.deepEqual(await tested({ folder }), {
    verdict: "inconclusive",
    reason: "The checkout's package.json has no script test, so it could not be started.",
  });
});
