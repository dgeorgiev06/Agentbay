import {
  testToolchain,
  type Files,
  type Outcome,
  type Wanted,
  type WantedCheck,
  type WantedCommand,
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

function commandFileOf(command: WantedCommand): string {
  const line = JSON.stringify(command.line);
  if (command.outcome === "does not end") {
    return [`console.log(${line});`, "setTimeout(() => {}, 600000);", ""].join("\n");
  }
  return [
    `for (let printed = 0; printed < ${String(command.times)}; printed += 1) {`,
    `  console.log(${line});`,
    "}",
    "for (const word of process.argv.slice(2)) {",
    "  console.log(word);",
    "}",
    `process.exitCode = ${String(command.exitCode)};`,
    "",
  ].join("\n");
}

function commandPathOf(command: WantedCommand): string {
  return `commands/${command.name}.mjs`;
}

function typescriptCheckout(wanted: Wanted): Files {
  const commands = wanted.commands.map((command): readonly [string, string] => [
    command.name,
    `node ${commandPathOf(command)}`,
  ]);
  const commandFiles = wanted.commands.map((command): readonly [string, string] => [
    commandPathOf(command),
    commandFileOf(command),
  ]);
  const scripts = Object.fromEntries([...wanted.checks.flatMap(scriptsOf), ...commands]);
  const test = wanted.testRun === "set up" ? { test: "node --test" } : {};
  const testFiles = wanted.testFiles.map((tests, index): readonly [string, string] => [
    `tests/file-${String(index + 1)}.test.ts`,
    testFileOf(tests),
  ]);
  return {
    "package.json": packageWith({ ...scripts, ...test }),
    "src/sums.ts": "export const two = 1 + 1;\n",
    ...Object.fromEntries(testFiles),
    ...Object.fromEntries(commandFiles),
  };
}

testToolchain({ mode: "typescript", checkout: typescriptCheckout });
