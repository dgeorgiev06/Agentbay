import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type CommandRan, type CommandRequest, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { countEvidence } from "../scripts/kinds/count.ts";
import type { Count, Request } from "../scripts/lib/request.ts";
import { ProofStep } from "../scripts/lib/step.ts";

type Files = Readonly<Record<string, string>>;

type Asked = { readonly calls: string[]; readonly runs: CommandRequest[] };

type Answer = { readonly ran: CommandRan } | { readonly failed: string };

type Copying = "made" | "refused";

const notHere = { ok: false, kind: "failed", message: "This test does not answer it." } as const;

const request: Request = {
  base: "base",
  head: "head",
  scope: ["**"],
  proven: [],
  judgement: [],
  declared: { files: [], names: { gained: [], lost: [], changed: [] } },
  bugs: [],
  sameOutput: [],
  noRise: [{ name: "debt", pattern: "rule:", paths: ["framework/feature-map-debt.yaml"] }],
};

const nothing = { text: "", cut: false };

const firstCopy = ".forge/copies/proof-1794996000000-1";

const secondCopy = ".forge/copies/proof-1794996000000-2";

function printed(text: string, milliseconds: number): Answer {
  return { ran: { end: { how: "exited", exitCode: 0 }, milliseconds, stdout: { text, cut: false }, stderr: nothing } };
}

function copyNameOf(input: Json): string {
  const name = fieldsOf(input).name;
  return typeof name === "string" ? name : "";
}

function copyAnswer(reference: string, input: Json, copying: Copying): Awaited<ReturnType<ScriptContext["call"]>> {
  if (reference !== "worktrees.copy") {
    return { ok: true, value: null };
  }
  return copying === "made"
    ? { ok: true, value: { folder: `.forge/copies/${copyNameOf(input)}` } }
    : { ok: false, kind: "failed", message: "The commit head is not known." };
}

function contextOf(asked: Asked, answers: readonly Answer[], copying: Copying): ScriptContext {
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
      return Promise.resolve(copyAnswer(reference, input, copying));
    },
    schemas: { check: unanswered, checkAgainst: unanswered },
    settings: {},
    now: () => new Date("2026-11-18T10:00:00Z"),
    spend: unanswered,
    random: unanswered,
    caller: undefined,
    skillInput: undefined,
  };
}

async function gathered(
  count: Count,
  given: {
    readonly spent: number;
    readonly answers: readonly Answer[];
    readonly copying?: Copying;
    readonly noRise?: Request["noRise"];
  },
): Promise<{ readonly asked: Asked; readonly found: unknown }> {
  const asked: Asked = { calls: [], runs: [] };
  const step = new ProofStep(contextOf(asked, given.answers, given.copying ?? "made"));
  step.spend(given.spent);
  const noRise = given.noRise ?? request.noRise;
  return { asked, found: await countEvidence(step, { ...request, noRise }, count) };
}

function runsOf(asked: Asked): readonly Json[] {
  return asked.runs.map((run) => [run.name, [...run.arguments], run.folder, run.timeLimitSeconds]);
}

const most: Count = { of: "most", pattern: "listTrust.state", paths: ["bay/broker", "bay/trust.ts"], most: 2 };

const copiedOnce = ["worktrees.copy", "worktrees.remove"];

const copiedTwice = [...copiedOnce, ...copiedOnce];

test("count: a count with a most counts the head alone, in one copy, adds the count of every file, and asks what is left of the step", async () => {
  const { asked, found } = await gathered(most, { spent: 1000, answers: [printed("1\n0\n2\n", 30_000)] });
  assert.deepEqual(found, { found: "most", most: 2, head: { known: true, lines: 3 } });
  assert.deepEqual(runsOf(asked), [
    ["count-matches", ["listTrust.state", "--", "bay/broker", "bay/trust.ts"], firstCopy, 735],
  ]);
  assert.deepEqual(asked.calls, copiedOnce);
});

test("count: a count that may not rise counts the head and then the base, each in its own copy, each asked what is left", async () => {
  const noRise: Count = { of: "no rise", pattern: "-x", paths: ["src"] };
  const answers = [printed("4\n", 30_000), printed("3\n1\n", 1_000)];
  const { asked, found } = await gathered(noRise, { spent: 1000, answers });
  assert.deepEqual(found, { found: "no rise", base: { known: true, lines: 4 }, head: { known: true, lines: 4 } });
  assert.deepEqual(runsOf(asked), [
    ["count-matches", ["-x", "--", "src"], firstCopy, 735],
    ["count-matches", ["-x", "--", "src"], secondCopy, 695],
  ]);
  assert.deepEqual(asked.calls, copiedTwice);
});

test("count: a declared count is counted by the same code with the settings' text and paths, and an undeclared name makes no copy", async () => {
  const declared = await gathered(
    { of: "declared", name: "debt" },
    { spent: 0, answers: [printed("27\n", 0), printed("26\n", 0)] },
  );
  assert.deepEqual(declared.found, {
    found: "no rise",
    base: { known: true, lines: 26 },
    head: { known: true, lines: 27 },
  });
  assert.deepEqual(
    declared.asked.runs.map((run) => run.arguments),
    [
      ["rule:", "--", "framework/feature-map-debt.yaml"],
      ["rule:", "--", "framework/feature-map-debt.yaml"],
    ],
  );
  const undeclared = await gathered({ of: "declared", name: "debts" }, { spent: 0, answers: [] });
  assert.deepEqual(undeclared.found, { found: "not declared", name: "debts" });
  assert.deepEqual(undeclared.asked.runs, []);
  assert.deepEqual(undeclared.asked.calls, []);
});

test("count: a count with no time left is not made, its side is not known, and the copy is removed", async () => {
  const { asked, found } = await gathered(most, { spent: 1735, answers: [] });
  assert.deepEqual(found, {
    found: "most",
    most: 2,
    head: { known: false, reason: "Counting at the head was not done: proof's own step had no time left for it." },
  });
  assert.deepEqual(asked.runs, []);
  assert.deepEqual(asked.calls, copiedOnce);
});

test("count: a copy that could not be made leaves the side not known, and nothing is run or removed", async () => {
  const { asked, found } = await gathered(most, { spent: 0, answers: [], copying: "refused" });
  assert.deepEqual(found, {
    found: "most",
    most: 2,
    head: { known: false, reason: "No copy of head could be made: The commit head is not known." },
  });
  assert.deepEqual(asked.runs, []);
  assert.deepEqual(asked.calls, ["worktrees.copy"]);
});

test("count: a count that failed to start, was stopped, ended with an error or printed too much is not known, and the copy is removed", async () => {
  const ran = (end: CommandRan["end"], stdout = nothing): Answer => ({
    ran: { end, milliseconds: 5, stdout, stderr: nothing },
  });
  const answers: readonly (readonly [Answer, string])[] = [
    [{ failed: "The command could not start." }, "Counting at the head could not be run: The command could not start."],
    [ran({ how: "timed-out" }), "Counting at the head did not finish within 735 seconds."],
    [ran({ how: "signalled", signal: "SIGKILL" }), "Counting at the head was stopped by the signal SIGKILL."],
    [
      ran({ how: "exited", exitCode: 2 }, { text: "1\n", cut: false }),
      "Counting at the head ended with the exit code 2: a path to count in does not exist or could not be read.",
    ],
    [
      ran({ how: "exited", exitCode: 0 }, { text: "1\n", cut: true }),
      "Counting at the head printed more than proof reads.",
    ],
  ];
  for (const [answer, reason] of answers) {
    const { asked, found } = await gathered(most, { spent: 1000, answers: [answer] });
    assert.deepEqual(found, { found: "most", most: 2, head: { known: false, reason } });
    assert.deepEqual(asked.calls, copiedOnce);
  }
});

test("count: an exit code of 1, which grep gives when no line holds the text, counts zero lines", async () => {
  const none: Answer = {
    ran: {
      end: { how: "exited", exitCode: 1 },
      milliseconds: 5,
      stdout: { text: "0\n0\n", cut: false },
      stderr: nothing,
    },
  };
  const { found } = await gathered(most, { spent: 0, answers: [none] });
  assert.deepEqual(found, { found: "most", most: 2, head: { known: true, lines: 0 } });
});

test("count: a declared count is found by its whole name, whatever order the settings declare it in", async () => {
  const debt = { name: "debt", pattern: "rule:", paths: ["debt.yaml"] };
  const entries = { name: "debt-entries", pattern: "- from:", paths: ["entries.yaml"] };
  const only = await gathered({ of: "declared", name: "debt" }, { spent: 0, answers: [], noRise: [entries] });
  assert.deepEqual(only.found, { found: "not declared", name: "debt" });
  for (const noRise of [
    [debt, entries],
    [entries, debt],
  ]) {
    for (const each of [debt, entries]) {
      const answers = [printed("1\n", 0), printed("1\n", 0)];
      const { asked } = await gathered({ of: "declared", name: each.name }, { spent: 0, answers, noRise });
      assert.deepEqual(
        asked.runs.map((run) => run.arguments),
        [
          [each.pattern, "--", ...each.paths],
          [each.pattern, "--", ...each.paths],
        ],
      );
    }
  }
});

test("count: output with a line that is not a whole number in digits is not known, and no total is made of it", async () => {
  for (const text of ["12abc\n", "1\n-1\n", "1\nx\n", "1.5\n", " 2\n"]) {
    const { asked, found } = await gathered(most, { spent: 0, answers: [printed(text, 0)] });
    assert.deepEqual(found, {
      found: "most",
      most: 2,
      head: { known: false, reason: "Counting at the head printed something other than counts." },
    });
    assert.deepEqual(asked.calls, copiedOnce);
  }
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
  git("add", "--all");
  git("commit", "--quiet", "--message", "A commit for proof's own test");
  return git("rev-parse", "HEAD").trim();
}

before(async () => {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-count-")));
  try {
    await mkdir(join(given, "components"), { recursive: true });
    await writeFile(join(given, "agentbay.config.yaml"), "adapter: claude-code\nbindings: {}\n", "utf8");
    project = await openModeProject(
      {
        adapter: "claude-code",
        modes: ["proof", "git-worktrees", "typescript"],
        bindings: { toolchain: "typescript", worktrees: "git-worktrees" },
        settings: { proof: { noRise: [{ name: "debt", pattern: "rule:", paths: ["debt.yaml"] }] } },
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

function counts(base: string, head: string): Json {
  const paths = ["src/one.ts", "src/two"];
  const proofs: readonly Json[] = [
    { kind: "count", pattern: "a.b", paths, most: 2 },
    { kind: "count", pattern: "a.b", paths, most: 1 },
    { kind: "count", pattern: "a.b", paths, noRise: true },
    { kind: "count", use: "debt" },
    { kind: "count", pattern: "a.b", paths: ["src/none"], most: 9 },
  ];
  return {
    slice: {
      name: "COUNT",
      kind: "mode",
      scope: ["**"],
      after: [],
      done: proofs.map((proof, index) => ({
        id: `count-${String(index + 1)}`,
        says: "A count.",
        level: "must",
        proof,
      })),
    },
    base,
    head,
    declared: { files: ["src/two/b.ts", "debt.yaml"], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  };
}

function countVerdicts(output: Json): Json {
  const verdicts = fieldsOf(output).verdicts;
  return Array.isArray(verdicts) ? verdicts.slice(0, 5) : null;
}

test("count with the real git-worktrees mode: the text is matched as written in copies of the commits, not in the project's folder, and every copy is removed", async () => {
  const ignored = [".agentbay/", ".forge/", "node_modules", "components/", "agentbay.config.yaml"];
  const base = await committed({
    ".gitignore": `${ignored.join("\n")}\n`,
    "src/one.ts": "a.b\naXb\n",
    "src/two/b.ts": "nothing\n",
    "debt.yaml": "- rule: one\n- rule: two\n",
  });
  const head = await committed({
    "src/two/b.ts": "a.b twice a.b\n",
    "debt.yaml": "- rule: one\n- rule: two\n- rule: three\n",
  });
  await written({ "src/one.ts": "a.b\na.b\na.b\n" });
  assert.deepEqual(countVerdicts(await project.output("proof.prove", counts(base, head))), [
    {
      item: "count-1",
      kind: "count",
      verdict: "passed",
      detail: "2 lines hold the counted text at the head, and at most 2 may.",
    },
    {
      item: "count-2",
      kind: "count",
      verdict: "failed",
      detail: "2 lines hold the counted text at the head, and at most 1 may.",
    },
    {
      item: "count-3",
      kind: "count",
      verdict: "failed",
      detail: "2 lines hold the counted text at the head, more than the 1 at the base.",
    },
    {
      item: "count-4",
      kind: "count",
      verdict: "failed",
      detail: "3 lines hold the counted text at the head, more than the 2 at the base.",
    },
    {
      item: "count-5",
      kind: "count",
      verdict: "inconclusive",
      reason:
        "Counting at the head ended with the exit code 2: a path to count in does not exist or could not be read.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
});
