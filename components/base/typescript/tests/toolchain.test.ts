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

function scriptsOf(check: WantedCheck): readonly (readonly [string, string])[] {
  const outcomes: Readonly<Record<Outcome, string>> = {
    passes: printing(check.line),
    fails: failingWith(check.line, 1),
    "does not end": hangingAfter(check.line),
  };
  return check.outcome === "not set up" ? [] : [[check.name, outcomes[check.outcome]]];
}

function bodyOf(wanted: WantedTest): string {
  switch (wanted.outcome) {
    case "passes":
      return "() => assert.equal(1 + 1, 2)";
    case "fails":
      return `() => assert.fail(${JSON.stringify(wanted.message)})`;
    case "does not end":
      return "() => new Promise((done) => setTimeout(done, 600000))";
  }
}

function testLineOf(wanted: WantedTest): string {
  return `test(${JSON.stringify(wanted.name)}, ${bodyOf(wanted)});`;
}

const imports = ['import assert from "node:assert/strict";', 'import { test } from "node:test";'];

function testFileOf(tests: WantedTestFile): string {
  if (tests === "does not load") {
    return [...imports, 'throw new Error("this file does not load");', 'test("never runs", () => {});', ""].join("\n");
  }
  return [...imports, ...tests.map(testLineOf), ""].join("\n");
}

function typescriptCheckout(wanted: Wanted): Files {
  const scripts = Object.fromEntries(wanted.checks.flatMap(scriptsOf));
  const test = wanted.testRun === "set up" ? { test: "node --test" } : {};
  const testFiles = wanted.testFiles.map((tests, index): readonly [string, string] => [
    `tests/file-${String(index + 1)}.test.ts`,
    testFileOf(tests),
  ]);
  return {
    "package.json": packageWith({ ...scripts, ...test }),
    "src/sums.ts": "export const two = 1 + 1;\n",
    ...Object.fromEntries(testFiles),
  };
}

testToolchain({ mode: "typescript", checkout: typescriptCheckout });
