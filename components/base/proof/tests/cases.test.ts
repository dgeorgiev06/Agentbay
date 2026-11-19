import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { bugsCaughtParts } from "../scripts/kinds/bugs-caught.ts";
import { checksParts } from "../scripts/kinds/checks.ts";
import { failsFirstParts } from "../scripts/kinds/fails-first.ts";
import type { Cases, FailingCase, TestRun } from "../scripts/lib/toolchain.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

type Files = Readonly<Record<string, string>>;

function failingCase(name: string, file: string, message: string): FailingCase {
  return { name, file, message, charactersCut: 0 };
}

const onTheBase = failingCase("the sum is 6", "tests/sum.test.ts", "the sum read 4");

const onTheHead = failingCase("the sum is 6", "tests/sum.test.ts", "the sum read 5");

const inTheCopy = failingCase("the sum is 6", "tests/sum-copy.test.ts", "the sum read 5");

function failedWith(cases: Cases): TestRun {
  return { ran: "failed", failed: 1, cases };
}

const passedRun: TestRun = { ran: "passed", passed: 3 };

const baseCases: Cases = { failures: [onTheBase], failuresNotListed: 0, notLoaded: [] };

function failsFirst(base: TestRun, head: TestRun): Verdict {
  const evidence = { found: "runs", base: { how: "ran", run: base }, head: { how: "ran", run: head } } as const;
  return verdictOf("DOD-1", "fails-first", failsFirstParts(evidence));
}

function checks(tests: TestRun, lint: "passed" | "failed" = "passed"): Verdict {
  const run = { ran: "ended", verdicts: [{ name: "lint", verdict: lint }] } as const;
  return verdictOf("DOD-2", "checks", checksParts({ copy: "made", checks: run, tests }));
}

function bugCaught(cases: Cases): Verdict {
  const run = { how: "ran", run: failedWith(cases) } as const;
  return verdictOf("bugs", "bugs-caught", bugsCaughtParts([{ name: "the sum is raised", run }]));
}

function casesOf(verdict: Verdict): Cases | undefined {
  return verdict.verdict === "failed" ? verdict.cases : undefined;
}

test("fails-first: a run that failed on the head gives the failed verdict the head's cases as the toolchain named them, not the base's", () => {
  const one: Cases = { failures: [onTheHead], failuresNotListed: 0, notLoaded: [] };
  assert.deepEqual(failsFirst(failedWith(baseCases), failedWith(one)), {
    item: "DOD-1",
    kind: "fails-first",
    verdict: "failed",
    detail: "The named tests fail on the head.",
    cases: one,
  });
  const two: Cases = { failures: [onTheHead, inTheCopy], failuresNotListed: 2, notLoaded: ["tests/a.test.ts"] };
  assert.deepEqual(casesOf(failsFirst(failedWith(baseCases), failedWith(two))), two);
});

test("fails-first: the files that did not load on the head are carried, one and two that differ in one character", () => {
  const one: Cases = { failures: [], failuresNotListed: 0, notLoaded: ["tests/a.test.ts"] };
  const two: Cases = { failures: [], failuresNotListed: 0, notLoaded: ["tests/a.test.ts", "tests/b.test.ts"] };
  assert.deepEqual(casesOf(failsFirst(failedWith(baseCases), failedWith(one))), one);
  assert.deepEqual(casesOf(failsFirst(failedWith(baseCases), failedWith(two))), two);
});

test("fails-first: an older toolchain that names no cases gives a failed verdict empty cases, never the base's", () => {
  assert.deepEqual(casesOf(failsFirst(failedWith(baseCases), failedWith({}))), {});
});

test("fails-first: no cases on a passed verdict whose base run failed, on a failed verdict whose head passed, or on an inconclusive one", () => {
  const passed = failsFirst(failedWith(baseCases), passedRun);
  assert.equal(passed.verdict, "passed");
  assert.equal("cases" in passed, false);
  const alreadyPassing = failsFirst(passedRun, passedRun);
  assert.equal(alreadyPassing.verdict, "failed");
  assert.equal("cases" in alreadyPassing, false);
  const stopped = failsFirst({ ran: "inconclusive", reason: "It was stopped." }, failedWith(baseCases));
  assert.equal(stopped.verdict, "inconclusive");
  assert.equal("cases" in stopped, false);
});

test("checks: a failed test run gives the failed verdict its cases; a check that failed beside tests that passed gives none", () => {
  const cases: Cases = { failures: [onTheHead, inTheCopy], failuresNotListed: 7, notLoaded: ["tests/a.test.ts"] };
  assert.deepEqual(checks(failedWith(cases), "failed"), {
    item: "DOD-2",
    kind: "checks",
    verdict: "failed",
    detail: "The check lint found a fault. 1 test failed.",
    cases,
  });
  const lintOnly = checks(passedRun, "failed");
  assert.equal(lintOnly.verdict, "failed");
  assert.equal("cases" in lintOnly, false);
});

test("no failing case's name, message or file, and no file that did not load, reaches a detail", () => {
  const cases: Cases = { failures: [onTheHead], failuresNotListed: 0, notLoaded: ["tests/a.test.ts"] };
  const details = [failsFirst(failedWith(baseCases), failedWith(cases)), checks(failedWith(cases))].map((verdict) =>
    verdict.verdict === "inconclusive" ? verdict.reason : verdict.detail,
  );
  const shown = details.filter((detail) =>
    ["the sum is 6", "the sum read", "tests/sum.test.ts", "tests/a.test.ts"].some((text) => detail.includes(text)),
  );
  assert.deepEqual(shown, []);
});

test("bugs-caught: a run that failed only because its test files did not load is inconclusive and says its tests did not run", () => {
  assert.deepEqual(bugCaught({ failures: [], failuresNotListed: 0, notLoaded: ["tests/a.test.ts"] }), {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "inconclusive",
    reason: "The tests of the bug the sum is raised did not run: 1 test file did not load, and no case failed.",
  });
  const two = bugCaught({ failures: [], failuresNotListed: 0, notLoaded: ["tests/a.test.ts", "tests/b.test.ts"] });
  assert.equal(
    two.verdict === "inconclusive" ? two.reason : two.detail,
    "The tests of the bug the sum is raised did not run: 2 test files did not load, and no case failed.",
  );
});

test("bugs-caught: a run with a failing case, listed or only counted, is caught even when a file did not load", () => {
  const caught = {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "passed",
    detail: "Every injected bug was caught: 1 of 1.",
  };
  assert.deepEqual(bugCaught({ failures: [onTheHead], failuresNotListed: 0, notLoaded: ["tests/a.test.ts"] }), caught);
  assert.deepEqual(bugCaught({ failures: [], failuresNotListed: 1, notLoaded: ["tests/a.test.ts"] }), caught);
});

test("bugs-caught: an older toolchain that does not say which files did not load is read as today, a failed run caught", () => {
  const caught = {
    item: "bugs",
    kind: "bugs-caught",
    verdict: "passed",
    detail: "Every injected bug was caught: 1 of 1.",
  };
  assert.deepEqual(bugCaught({}), caught);
  assert.deepEqual(bugCaught({ failures: [], failuresNotListed: 0 }), caught);
  assert.deepEqual(bugCaught({ failures: [], failuresNotListed: 0, notLoaded: [] }), caught);
});

let project: ModeProject;

function git(...parameters: readonly string[]): string {
  const identity = ["-c", "user.name=Proof Test", "-c", "user.email=proof-test@agentbay.invalid"];
  return execFileSync("git", [...identity, ...parameters], { cwd: project.root, encoding: "utf8" });
}

async function committed(files: Files): Promise<string> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(project.root, path)), { recursive: true });
    await writeFile(join(project.root, path), text, "utf8");
  }
  git("add", "--all");
  git("commit", "--quiet", "--message", "A commit for proof's own test");
  return git("rev-parse", "HEAD").trim();
}

function sumTest(expected: number): string {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    "",
    `test("the sum is ${String(expected)}", () => {`,
    '  const sum = readFileSync(join(import.meta.dirname, "..", "src", "sum.txt"), "utf8").trim();',
    `  assert.equal(sum, "${String(expected)}", \`the sum read \${sum}\`);`,
    "});",
    "",
  ].join("\n");
}

function failsFirstSlice(base: string, head: string, tests: readonly string[]): Json {
  return {
    slice: {
      name: "CASES",
      kind: "mode",
      scope: ["**"],
      after: [],
      done: [{ id: "first", says: "The tests fail first.", level: "must", proof: { kind: "fails-first", tests } }],
    },
    base,
    head,
    declared: { files: [], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  };
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function ownVerdict(output: Json): Json {
  const verdicts = fieldsOf(output).verdicts;
  return isList(verdicts) ? (verdicts[0] ?? null) : null;
}

before(async () => {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-cases-")));
  try {
    await mkdir(join(given, "components"), { recursive: true });
    await writeFile(join(given, "agentbay.config.yaml"), "adapter: claude-code\nbindings: {}\n", "utf8");
    project = await openModeProject(
      {
        adapter: "claude-code",
        modes: ["proof", "git-worktrees", "typescript"],
        bindings: { toolchain: "typescript", worktrees: "git-worktrees" },
      },
      { project: given },
    );
  } finally {
    await rm(given, { recursive: true, force: true });
  }
  const ignored = [".agentbay/", ".forge/", "node_modules", "components/", "agentbay.config.yaml"];
  await committed({ ".gitignore": `${ignored.join("\n")}\n` });
});

after(async () => {
  await project.close();
});

test("fails-first with the real toolchain: the failed verdict carries the head's failing case, its name, file and first message line as node gave them", async () => {
  const base = await committed({
    "package.json": '{ "scripts": { "test": "node --test" } }\n',
    "src/sum.txt": "4\n",
  });
  const head = await committed({ "src/sum.txt": "5\n", "tests/sum.test.ts": sumTest(6) });
  const output = await project.output("proof.prove", failsFirstSlice(base, head, ["tests/sum.test.ts"]));
  assert.deepEqual(ownVerdict(output), {
    item: "first",
    kind: "fails-first",
    verdict: "failed",
    detail: "The named tests fail on the head.",
    cases: {
      failures: [{ name: "the sum is 6", file: "tests/sum.test.ts", message: "the sum read 5", charactersCut: 0 }],
      failuresNotListed: 0,
      notLoaded: [],
    },
  });
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
});

test("fails-first with the real toolchain: two test files that did not load, each named to node by its absolute path and by proof's, are each listed once", async () => {
  const twice = 'node --test \\"$PWD/tests/broken.test.ts\\" \\"$PWD/tests/broken-too.test.ts\\"';
  const head = await committed({
    "package.json": `{ "scripts": { "test": "${twice}" } }\n`,
    "tests/broken.test.ts": "export const broken = ;\n",
    "tests/broken-too.test.ts": 'import "../src/missing.ts";\n',
  });
  const tests = ["tests/broken.test.ts", "tests/broken-too.test.ts"];
  const verdict = fieldsOf(ownVerdict(await project.output("proof.prove", failsFirstSlice(head, head, tests))));
  const cases = fieldsOf(verdict.cases ?? null);
  const notLoaded = isList(cases.notLoaded) ? [...cases.notLoaded].sort() : null;
  assert.deepEqual(
    { ...verdict, cases: { ...cases, notLoaded } },
    {
      item: "first",
      kind: "fails-first",
      verdict: "failed",
      detail: "The named tests fail on the head.",
      cases: { failures: [], failuresNotListed: 0, notLoaded: ["tests/broken-too.test.ts", "tests/broken.test.ts"] },
    },
  );
});
