import { availableParallelism } from "node:os";
import { relative, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { run } from "node:test";

type FileTime = {
  readonly file: string;
  readonly seconds: number;
  readonly tests: number;
  readonly failed: number;
  readonly passed: boolean;
};

type Tally = {
  readonly tests: number;
  readonly failed: number;
};

type Ended = {
  readonly name: string;
  readonly file?: string;
  readonly details: { readonly type?: "suite"; readonly passed?: boolean; readonly duration_ms: number };
};

const root = process.cwd();

const noTests: Tally = { tests: 0, failed: 0 };

const tallies = new Map<string, Tally>();

const times: FileTime[] = [];

function isWholeFile(name: string, file: string): boolean {
  return resolve(root, name) === file;
}

function counted(ended: Ended, failed: number): void {
  const { file, name, details } = ended;
  if (file === undefined || isWholeFile(name, file) || details.type === "suite") {
    return;
  }
  const tally = tallies.get(file) ?? noTests;
  tallies.set(file, { tests: tally.tests + 1, failed: tally.failed + failed });
}

function timed(ended: Ended): void {
  const { file, name, details } = ended;
  if (file === undefined || !isWholeFile(name, file)) {
    return;
  }
  const tally = tallies.get(file) ?? noTests;
  const seconds = details.duration_ms / 1000;
  times.push({ file: relative(root, file), seconds, passed: details.passed === true, ...tally });
}

function rowOf(time: FileTime, rank: number): string {
  const failed = time.passed ? "" : ` (${String(time.failed)} failed)`;
  return `| ${String(rank)} | ${time.seconds.toFixed(1)} | ${String(time.tests)}${failed} | ${time.file} |`;
}

function tableOf(all: readonly FileTime[]): string {
  const slowestFirst = [...all].sort((left, right) => right.seconds - left.seconds);
  const rows = slowestFirst.map((time, index) => rowOf(time, index + 1));
  return ["| Rank | Seconds | Tests | File |", "|---|---|---|---|", ...rows].join("\n");
}

console.log(`Each test file runs alone, one after another, on a machine with ${String(availableParallelism())} cores.`);

const started = performance.now();

const stream = run({ concurrency: 1 });

stream.on("test:pass", (data) => {
  counted(data, 0);
});

stream.on("test:fail", (data) => {
  counted(data, 1);
});

stream.on("test:complete", timed);

await finished(stream.resume());

const wall = (performance.now() - started) / 1000;

const tests = times.reduce((sum, time) => sum + time.tests, 0);

const failedTests = times.reduce((sum, time) => sum + time.failed, 0);

const failedFiles = times.filter((time) => !time.passed).length;

console.log("");
console.log(tableOf(times));
console.log("");
console.log(
  `${String(times.length)} files, ${String(tests)} tests, ${String(failedTests)} failed in ${String(failedFiles)} files.`,
);
console.log(`Wall time, one file at a time: ${wall.toFixed(1)} s.`);

process.exitCode = failedFiles === 0 ? 0 : 1;
