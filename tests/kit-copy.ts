import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ModeFiles = Readonly<Record<string, string>>;

export type ModeTestRun = {
  readonly status: number | null;
  readonly output: string;
};

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

export async function addMode(copy: string, folder: string, files: ModeFiles): Promise<void> {
  assert.equal(existsSync(join(copy, folder)), false, `the kit already holds ${folder}`);
  for (const [path, text] of Object.entries(files)) {
    const file = join(copy, folder, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

export function failedTests(output: string): readonly string[] {
  return [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1] ?? "");
}

export type Cases = "every case" | { readonly only: readonly string[] };

const charactersOfAPattern = /[.*+?^${}()|[\]\\/]/g;

function patternOf(name: string): string {
  const escaped = name.replace(charactersOfAPattern, "\\$&");
  return `^${escaped}$`;
}

export function modeTestFile(folder: string, name: string): string {
  return join(folder, name, "tests", `${name}.test.ts`);
}

function filterOf(cases: Cases): readonly string[] {
  if (cases === "every case") {
    return [];
  }
  assert.notEqual(cases.only.length, 0, "a filter that chooses no case would run none");
  return cases.only.flatMap((name) => ["--test-name-pattern", patternOf(name)]);
}

export function nodeRanIn(copy: string, parameters: readonly string[]): Promise<ModeTestRun> {
  const child = spawn(process.execPath, parameters, { cwd: copy, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  return new Promise((resolve) => {
    child.on("close", (status) => {
      resolve({ status, output });
    });
  });
}

export function modeTestRan(copy: string, file: string, cases: Cases): Promise<ModeTestRun> {
  return nodeRanIn(copy, ["--test", ...filterOf(cases), file]);
}

export function assertFailsOnlyTheChosenCases(tested: ModeTestRun, cases: readonly string[]): void {
  assert.notEqual(cases.length, 0, "a run that chose no case shows nothing");
  assert.deepEqual(failedTests(tested.output), cases);
  assert.match(tested.output, new RegExp(`^# tests ${String(cases.length)}$`, "m"), tested.output);
  assert.match(tested.output, /^# pass 0$/m, tested.output);
  assert.equal(tested.status, 1, tested.output);
}
