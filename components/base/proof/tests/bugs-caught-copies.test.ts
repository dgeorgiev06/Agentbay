import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { bugsCaughtEvidence } from "../scripts/kinds/bugs-caught.ts";
import type { Bug, Request } from "../scripts/lib/request.ts";
import { ProofStep } from "../scripts/lib/step.ts";

type Files = Readonly<Record<string, string>>;

type Asked = (readonly [string, Json])[];

const notHere = { ok: false, kind: "failed", message: "This test does not answer it." } as const;

const refused = { ok: false, kind: "failed", message: "The patch does not apply to the copy." } as const;

const request: Request = {
  base: "base",
  head: "head",
  scope: ["**"],
  proven: [],
  judgement: [],
  declared: { files: [], names: { gained: [], lost: [], changed: [] } },
  bugs: [],
  sameOutput: [],
  noRise: [],
};

const testAnswers: Readonly<Record<string, Json>> = {
  caught: { verdict: "failed", failed: 2, passed: 1, seconds: 100 },
  survives: { verdict: "passed", passed: 3, seconds: 20 },
};

function textOf(input: Json, name: string): string {
  const value = fieldsOf(input)[name];
  return typeof value === "string" ? value : "";
}

function contextOf(asked: Asked, unmade: boolean): ScriptContext {
  const unanswered = (): Promise<typeof notHere> => Promise.resolve(notHere);
  const statements = { execute: unanswered, query: unanswered };
  const patches = new Map<string, string>();
  const answerTo = (reference: string, input: Json): ReturnType<ScriptContext["call"]> => {
    switch (reference) {
      case "worktrees.copy":
        return Promise.resolve(
          unmade ? notHere : { ok: true, value: { folder: `.forge/copies/${textOf(input, "name")}` } },
        );
      case "worktrees.apply":
        patches.set(textOf(input, "folder"), textOf(input, "patch"));
        return Promise.resolve(textOf(input, "patch") === "stale" ? refused : { ok: true, value: null });
      case "toolchain.test": {
        const answer = testAnswers[patches.get(textOf(input, "folder")) ?? ""];
        return Promise.resolve(answer === undefined ? notHere : { ok: true, value: answer });
      }
      default:
        return Promise.resolve({ ok: true, value: null });
    }
  };
  return {
    db: { ...statements, partition: () => ({ ...statements, migrate: unanswered, agentQuery: unanswered }) },
    files: {
      read: unanswered,
      write: unanswered,
      list: unanswered,
      makeFolder: unanswered,
      link: unanswered,
      remove: unanswered,
    },
    secrets: { get: unanswered },
    http: { request: unanswered },
    events: { emit: unanswered },
    commands: { run: unanswered },
    call: (reference, input) => {
      asked.push([reference, input]);
      return answerTo(reference, input);
    },
    schemas: { check: unanswered, checkAgainst: unanswered },
    settings: { links: ["node_modules"] },
    now: () => new Date("2026-11-18T10:00:00Z"),
    spend: unanswered,
    caller: undefined,
    skillInput: undefined,
  };
}

function stepWith(spentBefore: number, unmade = false): { readonly asked: Asked; readonly step: ProofStep } {
  const asked: Asked = [];
  const step = new ProofStep(contextOf(asked, unmade));
  step.spend(spentBefore);
  return { asked, step };
}

function copyOf(number: number): Json {
  return { commit: "head", name: `proof-1794996000000-${String(number)}`, links: ["node_modules"] };
}

function folderOf(number: number): string {
  return `.forge/copies/proof-1794996000000-${String(number)}`;
}

function bugRunAsked(number: number, bug: Bug, seconds: number): Asked {
  const folder = folderOf(number);
  return [
    ["worktrees.copy", copyOf(number)],
    ["worktrees.apply", { folder, patch: bug.patch }],
    ["toolchain.test", { folder, files: bug.tests, timeLimitSeconds: seconds }],
    ["worktrees.remove", { folder }],
  ];
}

const caughtBug: Bug = { name: "the value is not raised", patch: "caught", tests: ["tests/value.test.ts"] };

const survivingBug: Bug = { name: "the name is lost", patch: "survives", tests: ["tests/name.test.ts"] };

test("bugs-caught: one bug gets a copy of the head, its patch and its own test files, with what is left of the step, and the copy is removed", async () => {
  const { asked, step } = stepWith(1000);
  assert.deepEqual(await bugsCaughtEvidence(step, { ...request, bugs: [caughtBug] }), [
    { name: "the value is not raised", run: { how: "ran", run: { ran: "failed", failed: 2, cases: {} } } },
  ]);
  assert.deepEqual(asked, bugRunAsked(1, caughtBug, 730));
});

test("bugs-caught: each of two bugs gets its own copy, only its own patch and its own test files, and each copy is removed, also after a survivor", async () => {
  const caught = { name: "the value is not raised", run: { how: "ran", run: { ran: "failed", failed: 2, cases: {} } } };
  const survived = { name: "the name is lost", run: { how: "ran", run: { ran: "passed", passed: 3 } } };
  const first = stepWith(1000);
  assert.deepEqual(await bugsCaughtEvidence(first.step, { ...request, bugs: [caughtBug, survivingBug] }), [
    caught,
    survived,
  ]);
  assert.deepEqual(first.asked, [...bugRunAsked(1, caughtBug, 730), ...bugRunAsked(2, survivingBug, 610)]);
  const second = stepWith(1000);
  assert.deepEqual(await bugsCaughtEvidence(second.step, { ...request, bugs: [survivingBug, caughtBug] }), [
    survived,
    caught,
  ]);
  assert.deepEqual(second.asked, [...bugRunAsked(1, survivingBug, 730), ...bugRunAsked(2, caughtBug, 690)]);
});

test("bugs-caught: a patch that does not apply runs no test and its copy is removed; the next bug still runs", async () => {
  const stale: Bug = { name: "the patch is stale", patch: "stale", tests: ["tests/value.test.ts"] };
  const { asked, step } = stepWith(0);
  assert.deepEqual(await bugsCaughtEvidence(step, { ...request, bugs: [stale, caughtBug] }), [
    { name: "the patch is stale", run: { how: "not applied", reason: "The patch does not apply to the copy." } },
    { name: "the value is not raised", run: { how: "ran", run: { ran: "failed", failed: 2, cases: {} } } },
  ]);
  assert.deepEqual(asked, [
    ["worktrees.copy", copyOf(1)],
    ["worktrees.apply", { folder: folderOf(1), patch: "stale" }],
    ["worktrees.remove", { folder: folderOf(1) }],
    ...bugRunAsked(2, caughtBug, 1000),
  ]);
});

test("bugs-caught: a test call the toolchain refuses could not start, its asked time is spent, and the copy is removed", async () => {
  const refusedRun: Bug = { name: "the value waits", patch: "refused", tests: ["tests/value.test.ts"] };
  const { asked, step } = stepWith(0);
  assert.deepEqual(await bugsCaughtEvidence(step, { ...request, bugs: [refusedRun, caughtBug] }), [
    { name: "the value waits", run: { how: "ran", run: { ran: "not started", reason: notHere.message } } },
    { name: "the value is not raised", run: { how: "ran", run: { ran: "failed", failed: 2, cases: {} } } },
  ]);
  assert.deepEqual(asked, [...bugRunAsked(1, refusedRun, 1000), ...bugRunAsked(2, caughtBug, 710)]);
});

test("bugs-caught: with no time left the test is not asked, the run could not start, and the copy is removed", async () => {
  const { asked, step } = stepWith(1735);
  assert.deepEqual(await bugsCaughtEvidence(step, { ...request, bugs: [caughtBug] }), [
    {
      name: "the value is not raised",
      run: {
        how: "ran",
        run: {
          ran: "not started",
          reason:
            "Proof's own step of 1800 seconds had no time left for it, so it was not made;" +
            " settings.proof.stepSeconds in agentbay.config.yaml raises the step.",
        },
      },
    },
  ]);
  assert.deepEqual(asked, [
    ["worktrees.copy", copyOf(1)],
    ["worktrees.apply", { folder: folderOf(1), patch: "caught" }],
    ["worktrees.remove", { folder: folderOf(1) }],
  ]);
});

test("bugs-caught: a copy not made applies nothing and removes nothing; no bugs asks for nothing", async () => {
  const unmade = stepWith(0, true);
  assert.deepEqual(await bugsCaughtEvidence(unmade.step, { ...request, bugs: [caughtBug] }), [
    {
      name: "the value is not raised",
      run: { how: "no copy", reason: `No copy of head could be made: ${notHere.message}` },
    },
  ]);
  assert.deepEqual(unmade.asked, [["worktrees.copy", copyOf(1)]]);
  const none = stepWith(0);
  assert.deepEqual(await bugsCaughtEvidence(none.step, request), []);
  assert.deepEqual(none.asked, []);
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

function patchOf(path: string, from: string, to: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${from}`,
    `+${to}`,
    "",
  ].join("\n");
}

const valueTest = [
  'import assert from "node:assert/strict";',
  'import { readFileSync } from "node:fs";',
  'import { join } from "node:path";',
  'import { test } from "node:test";',
  "",
  'test("the value is 2", () => {',
  '  assert.equal(readFileSync(join(import.meta.dirname, "..", "src", "value.txt"), "utf8"), "2\\n");',
  "});",
  "",
].join("\n");

const failingTest = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  "",
  'test("this test always fails, so a run of the whole suite catches every bug", () => {',
  "  assert.fail();",
  "});",
  "",
].join("\n");

const realBugs = {
  caught: { name: "the value is raised", patch: patchOf("src/value.txt", "2", "3"), tests: ["tests/value.test.ts"] },
  survives: {
    name: "the name is changed",
    patch: patchOf("src/name.txt", "Ada", "Bob"),
    tests: ["tests/value.test.ts"],
  },
  stale: { name: "the patch is stale", patch: patchOf("src/name.txt", "Eve", "Bob"), tests: ["tests/value.test.ts"] },
};

function sliceWith(base: string, head: string, bugs: readonly Json[]): Json {
  return {
    slice: {
      name: "BUGS",
      kind: "mode",
      scope: ["**"],
      after: [],
      done: [{ id: "bugs", says: "The bugs are caught.", level: "must", proof: { kind: "bugs-caught" } }],
    },
    base,
    head,
    declared: { files: ["src/value.txt"], names: { gained: [], lost: [], changed: [] } },
    bugs,
  };
}

function ownVerdict(output: Json): Json {
  const verdicts = fieldsOf(output).verdicts;
  return Array.isArray(verdicts) ? verdicts.slice(0, 1) : null;
}

before(async () => {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-bugs-caught-")));
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
});

after(async () => {
  await project.close();
});

test("bugs-caught with the real git-worktrees mode and toolchain: each bug runs only its test files in its own copy, a survivor fails the item, a stale patch makes it inconclusive, and every copy is removed", async () => {
  const ignored = [".agentbay/", ".forge/", "node_modules", "components/", "agentbay.config.yaml"];
  const base = await committed({
    ".gitignore": `${ignored.join("\n")}\n`,
    "package.json": '{ "scripts": { "test": "node --test" } }\n',
    "src/value.txt": "1\n",
    "src/name.txt": "Ada\n",
    "tests/value.test.ts": valueTest,
    "tests/always-fails.test.ts": failingTest,
  });
  const head = await committed({ "src/value.txt": "2\n" });
  const surviving = await project.output("proof.prove", sliceWith(base, head, [realBugs.caught, realBugs.survives]));
  assert.deepEqual(ownVerdict(surviving), [
    { item: "bugs", kind: "bugs-caught", verdict: "failed", detail: "A bug survived: the name is changed." },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
  const stale = await project.output("proof.prove", sliceWith(base, head, [realBugs.stale, realBugs.caught]));
  assert.deepEqual(ownVerdict(stale), [
    {
      item: "bugs",
      kind: "bugs-caught",
      verdict: "inconclusive",
      reason:
        "The bug the patch is stale could not be applied to the head: The patch does not apply to the copy, so nothing was changed: error: patch failed: src/name.txt:1",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
  assert.equal(await readFile(join(project.root, "src", "value.txt"), "utf8"), "2\n");
});

test("bugs-caught with the real toolchain: a bug that names a test file missing at the head is not known, and neither is a bug that stops its test file from loading, since its tests did not run", async () => {
  const head = await committed({
    "src/loaded.ts": "export const loaded = 1;\n",
    "tests/loads.test.ts": 'import "../src/loaded.ts";\n',
  });
  const missing = { ...realBugs.caught, name: "the tests are missing", tests: ["tests/missing.test.ts"] };
  const unloaded = await project.output("proof.prove", sliceWith(head, head, [missing]));
  assert.deepEqual(ownVerdict(unloaded), [
    {
      item: "bugs",
      kind: "bugs-caught",
      verdict: "inconclusive",
      reason:
        "The run with the bug the tests are missing is not known: The output ended without a summary of the tests, so the mode cannot tell whether they passed.",
    },
  ]);
  const syntax = {
    name: "the module does not load",
    patch: patchOf("src/loaded.ts", "export const loaded = 1;", "export const loaded = ;"),
    tests: ["tests/loads.test.ts"],
  };
  const loaded = await project.output("proof.prove", sliceWith(head, head, [syntax]));
  assert.deepEqual(ownVerdict(loaded), [
    {
      item: "bugs",
      kind: "bugs-caught",
      verdict: "inconclusive",
      reason:
        "The tests of the bug the module does not load did not run: 1 test file did not load, and no case failed.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
});
