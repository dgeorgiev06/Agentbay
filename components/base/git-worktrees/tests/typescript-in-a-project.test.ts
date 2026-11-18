import assert from "node:assert/strict";
import { readFile, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Json } from "../../../../bay/sdk.ts";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import { commitFiles, startedProject, writeFiles } from "./repository.ts";

type Fields = { readonly [key: string]: Json };

const kitPackages = fileURLToPath(new URL("../../../../node_modules", import.meta.url));

const kitPackageFile = fileURLToPath(new URL("../../../../package.json", import.meta.url));

const sums = "export function sum(left: number, right: number): number {\n  return left + right;\n}\n";

const four = 'import { sum } from "./sums.ts";\n\nexport const four: number = sum(2, 2);\n';

const wrongFour = 'import { sum } from "./sums.ts";\n\nexport const four: string = sum(2, 2);\n';

function testFile(fourIs: number): string {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { four } from "../src/four.ts";',
    'import { sum } from "../src/sums.ts";',
    "",
    'test("one and one make two", () => {',
    "  assert.equal(sum(1, 1), 2);",
    "});",
    "",
    'test("two and two make four", () => {',
    `  assert.equal(four, ${String(fourIs)});`,
    "});",
    "",
  ].join("\n");
}

const packageFiles = (devDependencies: Json): Readonly<Record<string, string>> => ({
  "package.json": `${JSON.stringify(
    {
      name: "small",
      private: true,
      type: "module",
      scripts: {
        typecheck: "tsc --noEmit -p .",
        lint: "eslint src tests",
        "format:check": "prettier --check src tests",
        deadcode: "knip --no-config-hints",
        test: "node --test",
      },
      devDependencies,
    },
    null,
    2,
  )}\n`,
  "tsconfig.json": `${JSON.stringify(
    {
      compilerOptions: {
        target: "es2024",
        module: "nodenext",
        types: ["node"],
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        erasableSyntaxOnly: true,
      },
      include: ["src", "tests"],
    },
    null,
    2,
  )}\n`,
  "eslint.config.js":
    'import tseslint from "typescript-eslint";\n\nexport default tseslint.config(tseslint.configs.recommended);\n',
  "knip.json": `${JSON.stringify({ entry: ["tests/*.test.ts"], project: ["src/**/*.ts", "tests/**/*.ts"] }, null, 2)}\n`,
  "src/sums.ts": sums,
  "src/four.ts": four,
  "tests/sums.test.ts": testFile(4),
});

function isVersions(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((version: unknown) => typeof version === "string")
  );
}

async function kitDevDependencies(): Promise<Json> {
  const kitPackage: unknown = JSON.parse(await readFile(kitPackageFile, "utf8"));
  const devDependencies: unknown =
    typeof kitPackage === "object" && kitPackage !== null ? Reflect.get(kitPackage, "devDependencies") : undefined;
  assert.ok(isVersions(devDependencies), JSON.stringify(devDependencies));
  return devDependencies;
}

let project: ModeProject;

let sound: string;

let broken: string;

function isFields(value: Json | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function lastLineOf(text: Json | undefined): string {
  const lines = typeof text === "string" ? text.split("\n").filter((line) => line.trim() !== "") : [];
  return lines[lines.length - 1] ?? "";
}

function shownVerdicts(output: Json): readonly Json[] {
  const verdicts = isFields(output) ? output.verdicts : undefined;
  assert.ok(isList(verdicts), JSON.stringify(output));
  return verdicts.map((verdict) =>
    isFields(verdict)
      ? { name: verdict.name ?? null, verdict: verdict.verdict ?? null, lastLine: lastLineOf(verdict.stdout) }
      : verdict,
  );
}

function shownTest(output: Json): Fields {
  assert.ok(isFields(output), JSON.stringify(output));
  const { verdict, passed, failed, failedTests } = output;
  return { verdict: verdict ?? null, passed: passed ?? null, failed: failed ?? null, failedTests: failedTests ?? null };
}

async function copyOf(commit: string, name: string): Promise<string> {
  const copy = await project.output("git-worktrees.copy", { commit, name, links: ["node_modules"] });
  assert.deepEqual(copy, { folder: `.forge/copies/${name}` });
  return `.forge/copies/${name}`;
}

before(async () => {
  const started = await startedProject(["git-worktrees", "typescript"], {
    branch: "main",
    files: packageFiles(await kitDevDependencies()),
    ignored: ["node_modules"],
  });
  project = started.project;
  await symlink(await realpath(kitPackages), join(project.root, "node_modules"));
  sound = started.base;
  broken = await commitFiles(project, {
    files: { "src/four.ts": wrongFour, "tests/sums.test.ts": testFile(5) },
    message: "Break the type of four and its test",
  });
  await writeFiles(project, ".", { "src/four.ts": four, "tests/sums.test.ts": testFile(4) });
});

after(async () => {
  await project.close();
});

test("describe in a project that is not the kit names its four checks, every agreed script as present, and practices in the mode's folder", async () => {
  assert.deepEqual(await project.output("typescript.describe", {}), {
    language: "TypeScript",
    sourceFiles: ["**/*.ts"],
    testFiles: ["**/*.test.ts"],
    practices: "practices.md",
    checks: ["typecheck", "lint", "format:check", "deadcode"],
    present: ["typecheck", "lint", "format:check", "deadcode", "test"],
    missing: [],
  });
});

test("in a throwaway copy of a sound commit, made by git-worktrees, every check and the test run pass with the project's own tools", async () => {
  const folder = await copyOf(sound, "sound");
  const checked = await project.output("typescript.check", { folder, timeLimitSeconds: 120 });
  const tested = await project.output("typescript.test", { folder, timeLimitSeconds: 120 });
  await project.output("git-worktrees.remove", { folder });
  assert.deepEqual(
    shownVerdicts(checked).map((verdict) => (isFields(verdict) ? { ...verdict, lastLine: "" } : verdict)),
    ["typecheck", "lint", "format:check", "deadcode"].map((name) => ({ name, verdict: "passed", lastLine: "" })),
    JSON.stringify(checked, null, 2),
  );
  assert.deepEqual(shownTest(tested), { verdict: "passed", passed: 2, failed: 0, failedTests: [] });
});

test("in a copy of a commit with a type error and a failing test, while the project's own files are sound, typecheck fails with tsc's line and test names the test", async () => {
  const folder = await copyOf(broken, "broken");
  const checkRun = await project.run("typescript.check", { folder, checks: ["typecheck"], timeLimitSeconds: 120 });
  const tested = await project.output("typescript.test", { folder, timeLimitSeconds: 120 });
  await project.output("git-worktrees.remove", { folder });
  assert.deepEqual(
    checkRun.events
      .filter((event) => event.kind === "command")
      .map((event) => (isFields(event.detail) ? (event.detail.folder ?? null) : null)),
    [folder, folder],
  );
  assert.ok(checkRun.state.status === "done", JSON.stringify(checkRun.state));
  assert.deepEqual(shownVerdicts(checkRun.state.output), [
    {
      name: "typecheck",
      verdict: "failed",
      lastLine: "src/four.ts(3,14): error TS2322: Type 'number' is not assignable to type 'string'.",
    },
  ]);
  assert.deepEqual(shownTest(tested), {
    verdict: "failed",
    passed: 1,
    failed: 1,
    failedTests: ["two and two make four"],
  });
});
