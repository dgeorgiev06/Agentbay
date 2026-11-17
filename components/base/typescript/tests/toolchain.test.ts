import {
  testToolchain,
  type Files,
  type Outcome,
  type Wanted,
  type WantedCheck,
  type WantedTest,
  type WantedTestFile,
} from "../../interfaces/toolchain/tests/shared.ts";
import { failingWith, hangingAfter, packageWith, printing } from "./checkouts.ts";

function scriptOf(check: WantedCheck): string {
  const outcomes: Readonly<Record<Outcome, string>> = {
    passes: printing(check.line),
    fails: failingWith(check.line, 1),
    "does not end": hangingAfter(check.line),
  };
  return outcomes[check.outcome];
}

function testLineOf(wanted: WantedTest): string {
  const name = JSON.stringify(wanted.name);
  const bodies: Readonly<Record<Outcome, string>> = {
    passes: "() => assert.equal(1 + 1, 2)",
    fails: "() => assert.equal(1 + 1, 3)",
    "does not end": "() => new Promise((done) => setTimeout(done, 600000))",
  };
  return `test(${name}, ${bodies[wanted.outcome]});`;
}

function testFileOf(tests: WantedTestFile): string {
  const imports = ['import assert from "node:assert/strict";', 'import { test } from "node:test";'];
  return [...imports, ...tests.map(testLineOf), ""].join("\n");
}

function typescriptCheckout(wanted: Wanted): Files {
  const scripts = Object.fromEntries(wanted.checks.map((check) => [check.name, scriptOf(check)]));
  const testFiles = wanted.testFiles.map((tests, index): readonly [string, string] => [
    `tests/file-${String(index + 1)}.test.ts`,
    testFileOf(tests),
  ]);
  return {
    "package.json": packageWith({ ...scripts, test: "node --test" }),
    "src/sums.ts": "export const two = 1 + 1;\n",
    ...Object.fromEntries(testFiles),
  };
}

testToolchain({ mode: "typescript", checkout: typescriptCheckout });
