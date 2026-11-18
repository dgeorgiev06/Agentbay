import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type CommandRan, type CommandRequest, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { realThingEvidence } from "../scripts/kinds/real-thing.ts";
import { sameOutputEvidence } from "../scripts/kinds/same-output.ts";
import type { Request } from "../scripts/lib/request.ts";
import { ProofStep } from "../scripts/lib/step.ts";

type Files = Readonly<Record<string, string>>;

type Asked = { readonly calls: string[]; readonly runs: CommandRequest[] };

type Answer = { readonly ran: CommandRan } | { readonly failed: string };

const notHere = { ok: false, kind: "failed", message: "This test does not answer it." } as const;

const request: Request = {
  base: "base",
  head: "head",
  scope: ["**"],
  proven: [],
  judgement: [],
  declared: { files: [], names: { gained: [], lost: [], changed: [] } },
  bugs: [],
  sameOutput: [{ name: "sound-check", bay: ["check", "--project", "fixtures/sound"] }],
  noRise: [],
};

const nothing = { text: "", cut: false };

function ended(exitCode: number, text: string, milliseconds: number): Answer {
  return { ran: { end: { how: "exited", exitCode }, milliseconds, stdout: { text, cut: false }, stderr: nothing } };
}

function copyNameOf(input: Json): string {
  const name = fieldsOf(input).name;
  return typeof name === "string" ? name : "";
}

function contextOf(asked: Asked, answers: readonly Answer[]): ScriptContext {
  const unanswered = (): Promise<typeof notHere> => Promise.resolve(notHere);
  const statements = { execute: unanswered, query: unanswered };
  let runsMade = 0;
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
    commands: {
      run: (command) => {
        asked.runs.push(command);
        const answer = answers[runsMade] ?? { failed: "No run was planned." };
        runsMade += 1;
        return Promise.resolve(
          "ran" in answer ? { ok: true, value: answer.ran } : { ok: false, kind: "failed", message: answer.failed },
        );
      },
    },
    call: (reference, input) => {
      asked.calls.push(reference);
      const answer = reference === "worktrees.copy" ? { folder: `.forge/copies/${copyNameOf(input)}` } : null;
      return Promise.resolve({ ok: true, value: answer });
    },
    schemas: { check: unanswered },
    settings: {},
    now: () => new Date("2026-11-18T10:00:00Z"),
    spend: unanswered,
    caller: undefined,
    skillInput: undefined,
  };
}

function stepWith(
  spentBefore: number,
  answers: readonly Answer[],
): { readonly asked: Asked; readonly step: ProofStep } {
  const asked: Asked = { calls: [], runs: [] };
  const step = new ProofStep(contextOf(asked, answers));
  step.spend(spentBefore);
  return { asked, step };
}

const copiedTwice = ["worktrees.copy", "worktrees.remove", "worktrees.copy", "worktrees.remove"];

test("same-output: the copy's bay.sh runs at the base and the head, each run asks for what is left of the step, each copy is removed, and standard error is not read", async () => {
  const warned: Answer = {
    ran: {
      end: { how: "exited", exitCode: 1 },
      milliseconds: 1_000,
      stdout: { text: "sound\n", cut: false },
      stderr: { text: "a warning\n", cut: false },
    },
  };
  const { asked, step } = stepWith(1000, [ended(0, "sound\n", 30_000), warned]);
  assert.deepEqual(await sameOutputEvidence(step, request), {
    found: "ran",
    commands: [
      {
        name: "sound-check",
        base: { ran: "ended", exitCode: 0, stdout: "sound\n" },
        head: { ran: "ended", exitCode: 1, stdout: "sound\n" },
      },
    ],
  });
  assert.deepEqual(
    asked.runs.map((run) => [run.name, run.arguments, run.folder, run.timeLimitSeconds]),
    [
      ["bay", ["check", "--project", "fixtures/sound"], ".forge/copies/proof-1794996000000-1", 735],
      ["bay", ["check", "--project", "fixtures/sound"], ".forge/copies/proof-1794996000000-2", 695],
    ],
  );
  assert.deepEqual(asked.calls, copiedTwice);
});

test("same-output: each declared command gets its own run at the base and at the head, whichever of them changed", async () => {
  const twoCommands: Request = {
    ...request,
    sameOutput: [
      { name: "first", bay: ["print", "first.txt"] },
      { name: "second", bay: ["print", "second.txt"] },
    ],
  };
  const unchanged = { ran: "ended", exitCode: 0, stdout: "first\n" } as const;
  const second = { ran: "ended", exitCode: 0, stdout: "second\n" } as const;
  const louder = { ran: "ended", exitCode: 0, stdout: "louder\n" } as const;
  const cases = [
    { head: ["first\n", "louder\n"], first: unchanged, second: louder },
    { head: ["louder\n", "second\n"], first: louder, second },
  ];
  for (const each of cases) {
    const answers = ["first\n", "second\n", ...each.head].map((text) => ended(0, text, 0));
    const { step } = stepWith(0, answers);
    assert.deepEqual(await sameOutputEvidence(step, twoCommands), {
      found: "ran",
      commands: [
        { name: "first", base: unchanged, head: each.first },
        { name: "second", base: second, head: each.second },
      ],
    });
  }
});

test("same-output: a project that declares no commands makes no copy and runs nothing", async () => {
  const { asked, step } = stepWith(0, []);
  assert.deepEqual(await sameOutputEvidence(step, { ...request, sameOutput: [] }), { found: "ran", commands: [] });
  assert.deepEqual(asked, { calls: [], runs: [] });
});

test("a run with no time left is not made and is not known, and the copies are removed", async () => {
  const { asked, step } = stepWith(1735, []);
  const notRun = { ran: "not known", reason: "Proof's own step had no time left for it, so it was not run." };
  assert.deepEqual(await sameOutputEvidence(step, request), {
    found: "ran",
    commands: [{ name: "sound-check", base: notRun, head: notRun }],
  });
  assert.deepEqual(asked.runs, []);
  assert.deepEqual(asked.calls, copiedTwice);
});

test("real-thing: a run that failed, was stopped at its limit, was signalled or printed too much is not known, and the copy is removed", async () => {
  const stopped: Answer = {
    ran: { end: { how: "timed-out" }, milliseconds: 5_000, stdout: nothing, stderr: nothing },
  };
  const signalled: Answer = {
    ran: { end: { how: "signalled", signal: "SIGKILL" }, milliseconds: 5, stdout: nothing, stderr: nothing },
  };
  const cut: Answer = {
    ran: { end: { how: "exited", exitCode: 0 }, milliseconds: 5, stdout: { text: "a", cut: true }, stderr: nothing },
  };
  const words = { bay: ["check"], stdout: "", exitCode: 0 };
  const { asked, step } = stepWith(0, [{ failed: "The command could not start." }, stopped, signalled, cut]);
  assert.deepEqual(await realThingEvidence(step, request, [words, words, words, words]), {
    found: "ran",
    runs: [
      { ran: "not known", reason: "It could not be run: The command could not start." },
      { ran: "not known", reason: "It did not finish within 735 seconds." },
      { ran: "not known", reason: "It was stopped by the signal SIGKILL." },
      { ran: "not known", reason: "It printed more than proof reads." },
    ],
  });
  assert.deepEqual(
    asked.runs.map((run) => run.timeLimitSeconds),
    [1000, 735, 730, 729],
  );
  assert.deepEqual(asked.calls, ["worktrees.copy", "worktrees.remove"]);
});

let project: ModeProject;

function git(...parameters: readonly string[]): string {
  const identity = ["-c", "user.name=Proof Test", "-c", "user.email=proof-test@agentbay.invalid"];
  return execFileSync("git", [...identity, ...parameters], { cwd: project.root, encoding: "utf8" });
}

async function written(files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(project.root, path)), { recursive: true });
    await writeFile(join(project.root, path), text, "utf8");
  }
}

async function committed(files: Files): Promise<string> {
  await written(files);
  await chmod(join(project.root, "bay.sh"), 0o755);
  git("add", "--all");
  git("commit", "--quiet", "--message", "A commit for proof's own test");
  return git("rev-parse", "HEAD").trim();
}

const bayScript = [
  'if [ "$(head -n 1 "$2")" = stop ]; then kill -9 $$; fi',
  'echo ran > "$(dirname "$0")/ran-here.txt"',
  'cat "$2"',
  "",
].join("\n");

const config = {
  adapter: "claude-code",
  modes: ["proof", "git-worktrees", "typescript"],
  bindings: { toolchain: "typescript", worktrees: "git-worktrees" },
  settings: { proof: { sameOutput: [{ name: "print-sum", bay: ["print", "fixtures/sum.txt"] }] } },
} as const;

before(async () => {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-same-output-")));
  try {
    await mkdir(join(given, "components"), { recursive: true });
    await writeFile(join(given, "agentbay.config.yaml"), "adapter: claude-code\nbindings: {}\n", "utf8");
    project = await openModeProject(config, { project: given });
  } finally {
    await rm(given, { recursive: true, force: true });
  }
});

after(async () => {
  await project.close();
});

function sliceWith(base: string, head: string, real: string): Json {
  return {
    slice: {
      name: "OUTPUT",
      kind: "mode",
      scope: ["**"],
      after: [],
      done: [
        {
          id: "output",
          says: "The sum changes.",
          level: "must",
          proof: { kind: "same-output", differ: ["print-sum"] },
        },
        {
          id: "real",
          says: "The sum is printed.",
          level: "must",
          proof: { kind: "real-thing", runs: [{ bay: ["print", "fixtures/sum.txt"], stdout: real, exitCode: 0 }] },
        },
      ],
    },
    base,
    head,
    declared: { files: ["fixtures/sum.txt"], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  };
}

function ownVerdicts(output: Json): Json {
  const verdicts = fieldsOf(output).verdicts;
  return Array.isArray(verdicts) ? verdicts.slice(0, 2) : null;
}

test("same-output and real-thing with the real git-worktrees mode: bay.sh runs in copies of the commits, never at the project's root, and every copy is removed, also after a run stopped by a signal", async () => {
  const ignored = [".agentbay/", ".forge/", "node_modules", "components/", "agentbay.config.yaml", "ran-here.txt"];
  const base = await committed({
    ".gitignore": `${ignored.join("\n")}\n`,
    "bay.sh": bayScript,
    "fixtures/sum.txt": "4\n",
  });
  const head = await committed({ "fixtures/sum.txt": "5\n" });
  await written({ "fixtures/sum.txt": "6 in the project's own folder\n" });
  assert.deepEqual(ownVerdicts(await project.output("proof.prove", sliceWith(base, head, "5\n"))), [
    {
      item: "output",
      kind: "same-output",
      verdict: "passed",
      detail: "Every declared command printed as the item says: 1 of 1, and 1 of them differs as named.",
    },
    {
      item: "real",
      kind: "real-thing",
      verdict: "passed",
      detail: "Every run printed the expected text and ended with the expected exit code: 1 of 1.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
  assert.equal(await readFile(join(project.root, "ran-here.txt"), "utf8").catch(() => "not ran here"), "not ran here");
  const stop = await committed({ "fixtures/sum.txt": "stop\n" });
  assert.deepEqual(ownVerdicts(await project.output("proof.prove", sliceWith(head, stop, "stop\n"))), [
    {
      item: "output",
      kind: "same-output",
      verdict: "inconclusive",
      reason: "The output of print-sum at the head is not known. It was stopped by the signal SIGKILL.",
    },
    {
      item: "real",
      kind: "real-thing",
      verdict: "inconclusive",
      reason: "Run 1 of 1 is not known. It was stopped by the signal SIGKILL.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
});
