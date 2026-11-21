import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { answered, bayRan, submitted } from "./kit-copy.ts";

type Answer = { readonly verdict: "approve" | "reject" } | { readonly choice: string };

type Waiting = {
  readonly id: string;
  readonly hash: string;
  readonly card: Json;
  readonly choices: Json;
  readonly refused?: Json;
};

type Planned = {
  readonly title: string;
  readonly slice: Json;
};

type Proved = {
  readonly verdicts: readonly Json[];
  readonly judgement: readonly Json[];
  readonly size: readonly Json[];
};

type Build = {
  readonly files: readonly string[];
  readonly built: Json;
  readonly refusedFirst?: Json;
};

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const standIn = "components/modes/proof-stand-in";

const into = "integration";

const practices = ["framework/practices.md", "components/base/typescript/practices.md"];

const noNames = { gained: [], lost: [], changed: [] };

const gitWords = [
  "-c",
  "user.name=forge test",
  "-c",
  "user.email=forge-test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

const sendBackWithheld = "No round runs after the card.";

const discardWithheld = "Discarding comes with slice WD1.";

const notBuilt = (kind: string): string =>
  `The kind ${kind} is not built in this version of the proof mode, so nothing is known.`;

const tr2Files = [
  "bay/broker/command-operations.ts",
  "bay/broker/file-operations.ts",
  "bay/broker/list-in-force.ts",
  "bay/broker/rule.ts",
  "bay/broker/step-broker.ts",
  "tests/broker-list-trust.test.ts",
  "tests/cli-trust-at-use.test.ts",
  "tests/script-commands.test.ts",
  "tests/shared-tests-in-a-project.test.ts",
  "tests/system-fixture.ts",
  "framework/features.yaml",
];

const tr2Planned: Planned = {
  title: "The broker says why a list is not in force, and reads the record again before each command",
  slice: {
    name: "TR2",
    kind: "capability",
    scope: [
      "bay/broker/**",
      "tests/broker-list-trust.test.ts",
      "tests/cli-trust-at-use.test.ts",
      "tests/script-commands.test.ts",
      "tests/shared-tests-in-a-project.test.ts",
      "tests/system-fixture.ts",
      "framework/features.yaml",
    ],
    after: [{ slice: "TR1", because: "ModeGrants.listTrust and readTrustRecord, which the broker reads" }],
    done: [
      {
        id: "DOD-TR2-1",
        says: "Each state refuses with its sentence",
        level: "must",
        proof: { kind: "fails-first", tests: ["tests/broker-list-trust.test.ts"] },
      },
      { id: "DOD-TR2-1b", says: "the sentences say what the owner does", level: "must" },
      {
        id: "DOD-TR2-2",
        says: "One function decides",
        level: "must",
        proof: { kind: "count", pattern: "listTrust.state", paths: ["bay/broker"], most: 2 },
      },
      {
        id: "DOD-TR2-3",
        says: "A run is refused",
        level: "must",
        proof: { kind: "fails-first", tests: ["tests/broker-list-trust.test.ts"] },
      },
      {
        id: "DOD-TR2-4",
        says: "bay call runs it",
        level: "must",
        proof: { kind: "fails-first", tests: ["tests/cli-trust-at-use.test.ts"] },
      },
      {
        id: "DOD-TR2-5",
        says: "Nothing changes",
        level: "must",
        proof: { kind: "same-output", differ: ["grants-check"] },
      },
      { id: "DOD-TR2-6a", says: "Neither debt list grows", level: "must", proof: { kind: "count", use: "debt" } },
      { id: "DOD-TR2-6b", says: "the copy-paste count does not rise", level: "must" },
      { id: "DOD-TR2-7", says: "Every injected bug is caught", level: "must", proof: { kind: "bugs-caught" } },
      { id: "DOD-TR2-8", says: "The checks and the tests pass", level: "must", proof: { kind: "checks" } },
    ],
  },
};

const tr2Bug = {
  name: "the record is not read again",
  patch: "--- a/bay/broker/rule.ts\n+++ b/bay/broker/rule.ts\n@@ -1 +1 @@\n-a\n+b\n",
  tests: ["tests/broker-list-trust.test.ts"],
};

const failsFirstPassed = "The named tests failed on the base with them laid over it, and pass on the head.";

const tr2Proved: Proved = {
  verdicts: [
    { item: "DOD-TR2-1", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
    { item: "DOD-TR2-2", kind: "count", verdict: "inconclusive", reason: notBuilt("count") },
    { item: "DOD-TR2-3", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
    { item: "DOD-TR2-4", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
    { item: "DOD-TR2-5", kind: "same-output", verdict: "inconclusive", reason: notBuilt("same-output") },
    { item: "DOD-TR2-6a", kind: "count", verdict: "inconclusive", reason: notBuilt("count") },
    { item: "DOD-TR2-7", kind: "bugs-caught", verdict: "inconclusive", reason: notBuilt("bugs-caught") },
    {
      item: "DOD-TR2-8",
      kind: "checks",
      verdict: "passed",
      detail: "Every check passed (typecheck, lint, format:check, deadcode), and so did the test run: 1374 tests.",
    },
    { item: "scope", kind: "in-scope", verdict: "inconclusive", reason: notBuilt("in-scope") },
    { item: "declared", kind: "as-declared", verdict: "inconclusive", reason: notBuilt("as-declared") },
  ],
  judgement: [
    { id: "DOD-TR2-1b", says: "the sentences say what the owner does", level: "must" },
    { id: "DOD-TR2-6b", says: "the copy-paste count does not rise", level: "must" },
  ],
  size: [
    { path: "bay/broker/command-operations.ts", base: 180, head: 200 },
    { path: "bay/broker/file-operations.ts", base: 160, head: 170 },
    { path: "bay/broker/list-in-force.ts", head: 60 },
    { path: "bay/broker/rule.ts", base: 170, head: 182 },
    { path: "bay/broker/step-broker.ts", base: 90, head: 95 },
    { path: "tests/broker-list-trust.test.ts", head: 300 },
    { path: "tests/cli-trust-at-use.test.ts", head: 80 },
    { path: "tests/script-commands.test.ts", base: 400, head: 405 },
    { path: "tests/shared-tests-in-a-project.test.ts", base: 120, head: 123 },
    { path: "tests/system-fixture.ts", base: 200, head: 205 },
    { path: "framework/features.yaml", base: 300, head: 301 },
  ],
};

let template: string;

const roots: string[] = [];

const standInManifest = [
  "name: proof-stand-in",
  "version: 1.0.0",
  "description: A stand-in for proof in forge's own test; it answers the verdicts the test wrote for the slice.",
  "implements: [proof@1]",
  "resources:",
  "  files: { read: [.stand-in/], write: [.stand-in/] }",
  "actions:",
  "  prove:",
  "    description: When forge's test needs proof's answer for a slice.",
  "    effects: [read, write, network, spend, delete]",
  "    run:",
  "      - script: scripts/prove.ts",
  "",
].join("\n");

const standInScript = [
  'import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const name = fieldsOf(fieldsOf(input).slice ?? null).name;",
  "  const asked = await context.files.write(`.stand-in/${String(name)}-asked.json`, JSON.stringify(input));",
  "  if (!asked.ok) {",
  "    fail(asked.message);",
  "  }",
  "  const read = await context.files.read(`.stand-in/${String(name)}.json`);",
  "  return read.ok ? JSON.parse(read.value) : fail(read.message);",
  "});",
  "",
].join("\n");

function git(root: string, words: readonly string[]): string {
  return execFileSync("git", [...gitWords, ...words], { cwd: root, encoding: "utf8" });
}

function kitFiles(): readonly string[] {
  const listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: kit });
  return listing
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "");
}

function jsonOf(text: string): Json {
  const read = readYaml(text);
  assert.ok(read.ok, text);
  return read.value;
}

async function configForTheTest(): Promise<string> {
  const config = fieldsOf(jsonOf(await readFile(join(kit, "agentbay.config.yaml"), "utf8")));
  const settings = fieldsOf(config.settings ?? null);
  return JSON.stringify({
    ...config,
    bindings: { ...fieldsOf(config.bindings ?? null), proof: "proof-stand-in" },
    approvals: { from: ["terminal", "chat"] },
    skillSteps: { run: "without-the-hook" },
    settings: { ...settings, forge: { ...fieldsOf(settings.forge ?? null), into, practices } },
  });
}

async function writeTemplate(folder: string): Promise<void> {
  const files = kitFiles();
  for (const path of files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await cp(join(kit, path), join(folder, path));
  }
  await writeFile(join(folder, "agentbay.config.yaml"), await configForTheTest(), "utf8");
  await mkdir(join(folder, standIn, "scripts"), { recursive: true });
  await writeFile(join(folder, standIn, "mode.yaml"), standInManifest, "utf8");
  await writeFile(join(folder, standIn, "scripts/prove.ts"), standInScript, "utf8");
  const listed = [...files, `${standIn}/mode.yaml`, `${standIn}/scripts/prove.ts`];
  await writeFile(join(folder, ".git-files"), listed.join("\0"), "utf8");
  git(folder, ["init", "-q", "--initial-branch=main"]);
  git(folder, ["add", "-f", "--pathspec-from-file=.git-files", "--pathspec-file-nul"]);
  git(folder, ["commit", "-q", "-m", "The kit as the test found it"]);
}

async function madeFolder(prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(folder);
  return folder;
}

before(async () => {
  template = await madeFolder("agentbay-one-slice-");
  await writeTemplate(template);
});

after(async () => {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
});

async function project(): Promise<string> {
  const root = await madeFolder("agentbay-one-slice-case-");
  git(root, ["clone", "-q", template, "."]);
  git(root, ["branch", into]);
  await symlink(await realpath(join(kit, "node_modules")), join(root, "node_modules"));
  return root;
}

async function bay(root: string, words: readonly string[]): Promise<Json> {
  return jsonOf((await bayRan(root, [...words, "--json"])).stdout);
}

function runOf(answer: Json): Json {
  return fieldsOf(answer).run ?? null;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

function textAt(value: Json, key: string): string {
  const found = fieldsOf(value)[key];
  return typeof found === "string" ? found : "";
}

function waitingOf(run: Json, step: string): Waiting {
  const waiting = fieldsOf(run).waiting ?? null;
  assert.equal(textAt(waiting, "stepKey"), step, JSON.stringify(run));
  const { card = null, choices = null } = fieldsOf(waiting);
  return { id: textAt(run, "id"), hash: textAt(waiting, "hash"), card, choices };
}

async function started(root: string, planned: Planned, bugs: readonly Json[] = []): Promise<Waiting> {
  const trigger = JSON.stringify({ planned, base: shortHead(root), bugs });
  const answer = await bay(root, ["call", "--workflow", "forge:workflows/one-slice.yaml", trigger]);
  return waitingOf(runOf(answer), "start");
}

function answerWords(answer: Answer): readonly string[] {
  if ("choice" in answer) {
    return ["--choice", answer.choice];
  }
  return answer.verdict === "reject" ? ["--reject"] : [];
}

function decisionWords(waiting: Waiting, step: string, answer: Answer): readonly string[] {
  const asked = answerWords(answer);
  return ["approve", waiting.id, step, "--hash", waiting.hash, ...asked, "--via", "chat", "--quote", "as the owner"];
}

async function decided(root: string, waiting: Waiting, answer: Answer & { readonly step: string }): Promise<Json> {
  return bay(root, decisionWords(waiting, answer.step, answer));
}

async function shownCard(root: string, runId: string): Promise<readonly string[]> {
  const lines = (await bayRan(root, ["runs", runId])).stdout.split("\n");
  return lines.slice(
    1,
    lines.findIndex((line) => line.startsWith("decide with:")),
  );
}

function shortHead(root: string): string {
  return git(root, ["rev-parse", "--short=7", "main"]).trim();
}

function planned(name: string, scope: readonly string[], done: readonly Json[]): Planned {
  return { title: `The slice ${name}`, slice: { name, kind: "mode", scope: [...scope], after: [], done: [...done] } };
}

function item(id: string, level: "must" | "should", kind: string): Json {
  return { id, says: `${id} holds.`, level, proof: { kind } };
}

function passed(id: string, kind: string): Json {
  return { item: id, kind, verdict: "passed", detail: "It held." };
}

function notKnown(id: string, kind: string): Json {
  return { item: id, kind, verdict: "inconclusive", reason: "The run on the head is not known." };
}

async function provedIn(root: string, name: string, proved: Proved): Promise<void> {
  await mkdir(join(root, ".stand-in"), { recursive: true });
  await writeFile(join(root, ".stand-in", `${name}.json`), JSON.stringify(proved), "utf8");
}

async function builderWrites(root: string, name: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const path = join(root, ".forge/worktrees", name, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `Written by the builder of ${name}.\n`, "utf8");
  }
}

function branches(root: string): readonly string[] {
  const listed = git(root, ["branch", "--list", "--format=%(refname:short)", "forge/*"]);
  return listed.split("\n").filter((line) => line !== "");
}

function worktrees(root: string): readonly string[] {
  const listed = git(root, ["worktree", "list", "--porcelain"]).split("\n");
  const folders = listed.filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  return folders.filter((folder) => folder !== root).map((folder) => folder.slice(root.length + 1));
}

function changedOn(root: string, branch: string): readonly string[] {
  return git(root, ["diff", "--name-only", "main", branch])
    .split("\n")
    .filter((line) => line !== "");
}

function wordsOf(waiting: Waiting): readonly string[] {
  return listOf(fieldsOf(waiting.card).lines).map((line) => textAt(line, "words"));
}

async function refusedProblems(root: string, runId: string, output: Json | undefined): Promise<Json> {
  if (output === undefined) {
    return null;
  }
  const refused = fieldsOf(await answered(root, runId, output));
  assert.equal(refused.ok, false);
  return listOf(refused.problems).filter((problem) => textAt(problem, "path").startsWith("/output/missing/"));
}

async function builtToCard(root: string, start: Waiting, build: Build): Promise<Waiting> {
  const approved = runOf(await decided(root, start, { step: "start", verdict: "approve" }));
  assert.equal(textAt(approved, "status"), "waiting");
  await submitted(root, start.id, { files: [...build.files], names: noNames });
  const folder = worktrees(root)[0] ?? "";
  await builderWrites(root, folder.slice(".forge/worktrees/".length), build.files);
  const refused = await refusedProblems(root, start.id, build.refusedFirst);
  const card = waitingOf(await submitted(root, start.id, build.built), "card");
  return refused === null ? card : { ...card, refused };
}

function assertTheMainCheckoutIsUntouched(root: string): void {
  assert.equal(git(root, ["symbolic-ref", "--short", "HEAD"]).trim(), "main");
  assert.equal(git(root, ["rev-parse", "main"]).trim(), git(root, ["rev-parse", "origin/main"]).trim());
  assert.equal(git(root, ["status", "--porcelain", "--untracked-files=no"]), "");
}

describe("one slice, from a plan's slice to the merge card", { concurrency: true }, () => {
  test("1. every verdict passed: merge is offered, and taking it merges the builder's files into a branch nobody has checked out", async () => {
    const root = await project();
    const files = ["docs/a1/notes.md", "components/base/a1/mode.yaml"];
    const slice = planned("A1", ["docs/a1/**", "components/base/a1/**"], [item("DOD-A1-1", "must", "checks")]);
    await provedIn(root, "A1", {
      verdicts: [passed("DOD-A1-1", "checks"), passed("scope", "in-scope"), passed("declared", "as-declared")],
      judgement: [],
      size: files.map((path) => ({ path, head: 1 })),
    });
    const card = await builtToCard(root, await started(root, slice), { files, built: { outcome: "built" } });
    assert.deepEqual(card.choices, [
      { name: "merge", status: "offered", does: "Merge into the integration branch" },
      { name: "send-back", status: "withheld", does: "Round 2, a fresh builder", reason: sendBackWithheld },
      { name: "keep", status: "offered", does: "Stop; the branches stay" },
      { name: "discard", status: "withheld", does: "Stop; the worktree goes", reason: discardWithheld },
    ]);
    const work = git(root, ["rev-parse", "forge/wip/A1/1"]).trim();
    const done = runOf(await decided(root, card, { step: "card", choice: "merge" }));
    const merged = git(root, ["rev-parse", into]).trim();
    assert.deepEqual(fieldsOf(done).output, { choice: "merge", merged, into });
    assert.deepEqual(branches(root), []);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(changedOn(root, into), ["components/base/a1/mode.yaml", "docs/a1/notes.md"]);
    assert.equal(git(root, ["show", `${into}:docs/a1/notes.md`]), "Written by the builder of A1.\n");
    assert.equal(git(root, ["rev-parse", `${into}^2`]).trim(), work);
    assertTheMainCheckoutIsUntouched(root);
  });

  test("2. one must item not known: merge is withheld with draw's reason, asking for it is refused, and keep keeps both branches", async () => {
    const root = await project();
    const files = ["docs/a2/notes.md"];
    const done = [item("DOD-A2-1", "must", "checks"), item("DOD-A2-2", "should", "bugs-caught")];
    await provedIn(root, "A2", {
      verdicts: [
        notKnown("DOD-A2-1", "checks"),
        passed("DOD-A2-2", "bugs-caught"),
        passed("scope", "in-scope"),
        passed("declared", "as-declared"),
      ],
      judgement: [],
      size: [{ path: "docs/a2/notes.md", head: 1 }],
    });
    const card = await builtToCard(root, await started(root, planned("A2", ["docs/a2/**"], done)), {
      files,
      built: { outcome: "built" },
    });
    const choices = listOf(card.choices);
    assert.deepEqual(choices[0], {
      name: "merge",
      status: "withheld",
      does: "Merge into the integration branch",
      reason: "1 must item is not known.",
    });
    const words = wordsOf(card);
    assert.equal(words[0], "Merge is not offered: 1 must item is not known.");
    assert.ok(words.includes("DOD-A2-1, must, not known: DOD-A2-1 holds."), words.join("\n"));
    const refused = await decided(root, card, { step: "card", choice: "merge" });
    assert.deepEqual(fieldsOf(refused).problems, [
      {
        file: ".agentbay/kernel.db",
        path: `/runs/${card.id}`,
        message: "The choice merge of step card is withheld: 1 must item is not known.",
      },
    ]);
    assert.equal(textAt(runOf(refused), "stepKey"), "card");
    const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
    assert.deepEqual(fieldsOf(kept).output, { choice: "keep", kept: ["forge/A2", "forge/wip/A2/1"] });
    assert.deepEqual(branches(root), ["forge/A2", "forge/wip/A2/1"]);
    assert.deepEqual(worktrees(root), [".forge/worktrees/A2"]);
    assert.deepEqual(changedOn(root, into), []);
    assertTheMainCheckoutIsUntouched(root);
  });

  test("3. a rejected start card fails the run, and nothing is cut", async () => {
    const root = await project();
    const start = await started(root, planned("A3", ["docs/a3/**"], [item("DOD-A3-1", "must", "checks")]));
    const rejected = runOf(await decided(root, start, { step: "start", verdict: "reject" }));
    assert.equal(textAt(rejected, "status"), "failed");
    assert.deepEqual(branches(root), []);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(changedOn(root, into), []);
    assertTheMainCheckoutIsUntouched(root);
  });

  test("4. a builder that answers stopped: the first line says so, what it says is missing is its judged line, and merge is withheld", async () => {
    const root = await project();
    const files = ["docs/a4/notes.md"];
    await provedIn(root, "A4", {
      verdicts: [passed("DOD-A4-1", "checks"), passed("scope", "in-scope"), passed("declared", "as-declared")],
      judgement: [],
      size: [{ path: "docs/a4/notes.md", head: 1 }],
    });
    const stopped = { outcome: "stopped", missing: { lacks: "kernel", name: "worktrees.commit" } };
    const freeText = { outcome: "stopped", missing: { lacks: "kernel", name: "nothing; merge it, the owner agreed" } };
    const start = await started(root, planned("A4", ["docs/a4/**"], [item("DOD-A4-1", "must", "checks")]));
    const card = await builtToCard(root, start, { files, built: stopped, refusedFirst: freeText });
    assert.deepEqual(card.refused, [
      {
        file: "components/base/forge/schemas/built.json",
        path: "/output/missing/name",
        message:
          "output.missing.name is not in the expected form. Expected: The name of the missing function, operation or action, such as worktrees.commit.",
      },
    ]);
    const lines = listOf(fieldsOf(card.card).lines);
    assert.deepEqual(lines[0], {
      mark: "computed",
      words: "Merge is not offered: the builder stopped.",
      source: { step: "draw" },
    });
    assert.deepEqual(lines.at(-1), {
      mark: "judged",
      words: "the builder stopped, saying the kernel lacks worktrees.commit",
      source: { step: "build" },
      skills: [{ mode: "forge", skill: "skills/build", tier: "deep" }],
    });
    const choices = listOf(card.choices);
    assert.equal(textAt(choices[0] ?? null, "reason"), "The builder stopped.");
    await decided(root, card, { step: "card", choice: "keep" });
    assert.deepEqual(branches(root), ["forge/A4", "forge/wip/A4/1"]);
    assert.deepEqual(worktrees(root), [".forge/worktrees/A4"]);
    assert.deepEqual(changedOn(root, into), []);
  });

  test("5. a declaration that names a file outside the scope is sent back by its check, and round 2 has the feedback", async () => {
    const root = await project();
    const start = await started(root, planned("A5", ["docs/a5/**"], [item("DOD-A5-1", "must", "checks")]));
    await decided(root, start, { step: "start", verdict: "approve" });
    const outside = await submitted(root, start.id, { files: ["docs/a5/notes.md", "bay/run.ts"], names: noNames });
    const task = fieldsOf(outside).task ?? null;
    assert.equal(textAt(outside, "stepKey"), "declare/0#2");
    assert.deepEqual(fieldsOf(task).feedback, [
      "The declaration names a file outside the slice's write scope: bay/run.ts. Declare only files the scope admits: docs/a5/**.",
    ]);
    assert.equal(fieldsOf(task).round, 2);
    const inside = await submitted(root, start.id, { files: ["docs/a5/notes.md"], names: noNames });
    assert.equal(textAt(inside, "stepKey"), "build/0#1");
    assert.deepEqual(branches(root), ["forge/A5"]);
    assert.deepEqual(worktrees(root), [".forge/worktrees/A5"]);
    assert.deepEqual(changedOn(root, into), []);
  });

  test("6. the cards for TR2's verdicts, as the kernel prints them: every line computed, none citing build, the answer first", async () => {
    const root = await project();
    await provedIn(root, "TR2", tr2Proved);
    const start = await started(root, tr2Planned, [tr2Bug]);
    const startPrinted = await shownCard(root, start.id);
    assert.deepEqual(startPrinted, [
      "Build slice TR2?",
      "  The broker says why a list is not in",
      "    force, and reads the record again before",
      "    each command",
      `  kind capability; base ${shortHead(root)}`,
      "  scope: bay/broker/** and 6 more paths",
      "  after TR1: ModeGrants.listTrust and",
      "    readTrustRecord, which the broker reads",
      "  DOD-TR2-1, must: Each state refuses with",
      "    its sentence",
      "  held by: a test fails first",
      "  tests: tests/broker-list-trust.test.ts",
      "  DOD-TR2-1b, must: the sentences say what",
      "    the owner does",
      "  held by: your judgement",
      "  DOD-TR2-2, must: One function decides",
      "  held by: a count",
      '  lines with "listTrust.state" in',
      "    bay/broker: at most 2",
      "  DOD-TR2-3, must: A run is refused",
      "  held by: a test fails first",
      "  tests: tests/broker-list-trust.test.ts",
      "  DOD-TR2-4, must: bay call runs it",
      "  held by: a test fails first",
      "  tests: tests/cli-trust-at-use.test.ts",
      "  DOD-TR2-5, must: Nothing changes",
      "  held by: same output",
      "  compares the settings' commands;",
      "    grants-check must differ",
      "  DOD-TR2-6a, must: Neither debt list grows",
      "  held by: a count",
      "  the settings' count debt: no rise",
      "  DOD-TR2-6b, must: the copy-paste count",
      "    does not rise",
      "  held by: your judgement",
      "  DOD-TR2-7, must: Every injected bug is",
      "    caught",
      "  held by: bugs caught",
      "  DOD-TR2-8, must: The checks and the tests",
      "    pass",
      "  held by: checks",
      "  1 bug to inject: the record is not read",
      "    again",
      "All lines worked out by script.",
      "checked: 0 ran, 31 computed, 0 judged",
      `hash ${start.hash.slice(0, 12)}`,
    ]);
    assert.ok(startPrinted.every((row) => Array.from(row).length <= 44));
    const card = await builtToCard(root, start, { files: tr2Files, built: { outcome: "built" } });
    const printed = await shownCard(root, card.id);
    assert.deepEqual(printed, [
      "Merge TR2 into integration?",
      "  Merge is not offered: 4 must items, scope",
      "    and declared are not known.",
      "  DOD-TR2-1, must, passed: Each state",
      "    refuses with its sentence",
      "  DOD-TR2-1b, must, for you to judge: the",
      "    sentences say what the owner does",
      "  DOD-TR2-2, must, not known: One function",
      "    decides",
      "  why: proof does not judge this kind yet",
      "  proof's reason: The kind count is not",
      "    built in this version of the proof mode,",
      "    so nothing is known.",
      "  DOD-TR2-3, must, passed: A run is refused",
      "  DOD-TR2-4, must, passed: bay call runs it",
      "  DOD-TR2-5, must, not known: Nothing",
      "    changes",
      "  why: proof does not judge this kind yet",
      "  proof's reason: The kind same-output is",
      "    not built in this version of the proof",
      "    mode, so nothing is known.",
      "  DOD-TR2-6a, must, not known: Neither debt",
      "    list grows",
      "  why: proof does not judge this kind yet",
      "  proof's reason: The kind count is not",
      "    built in this version of the proof mode,",
      "    so nothing is known.",
      "  DOD-TR2-6b, must, for you to judge: the",
      "    copy-paste count does not rise",
      "  DOD-TR2-7, must, not known: Every injected",
      "    bug is caught",
      "  why: proof does not judge this kind yet",
      "  proof's reason: The kind bugs-caught is",
      "    not built in this version of the proof",
      "    mode, so nothing is known.",
      "  DOD-TR2-8, must, passed: The checks and",
      "    the tests pass",
      "  checks passed: typecheck, lint,",
      "    format:check, deadcode",
      "  tests passed: 1,374",
      "  scope, must, not known: Every changed path",
      "    is in the write scope.",
      "  why: proof does not judge this kind yet",
      "  proof's reason: The kind in-scope is not",
      "    built in this version of the proof mode,",
      "    so nothing is known.",
      "  declared, must, not known: What changed is",
      "    as declared.",
      "  why: proof does not judge this kind yet",
      "  proof's reason: The kind as-declared is",
      "    not built in this version of the proof",
      "    mode, so nothing is known.",
      "  11 files changed; the work is set aside on",
      "    forge/wip/TR2/1",
      "  size in lines: bay/ +107, tests/ +393,",
      "    framework/ +1",
      "  kernel file changed:",
      "    bay/broker/command-operations.ts",
      "  kernel file changed:",
      "    bay/broker/file-operations.ts",
      "  kernel file changed:",
      "    bay/broker/list-in-force.ts",
      "  kernel file changed: bay/broker/rule.ts",
      "  kernel file changed:",
      "    bay/broker/step-broker.ts",
      "All lines worked out by script.",
      "You can:",
      "  keep  Stop; the branches stay",
      "Not available:",
      "  merge      Merge into the integration",
      "             branch",
      "             why: 4 must items, scope and",
      "             declared are not known.",
      "  send-back  Round 2, a fresh builder",
      "             why: No round runs after the",
      "             card.",
      "  discard    Stop; the worktree goes",
      "             why: Discarding comes with",
      "             slice WD1.",
      "checked: 0 ran, 34 computed, 0 judged",
      `hash ${card.hash.slice(0, 12)}`,
    ]);
    assert.ok(printed.every((row) => Array.from(row).length <= 44));
    const lines = fieldsOf(card.card).lines;
    const sources = listOf(lines).map((line: Json) => ({
      mark: textAt(line, "mark"),
      step: textAt(fieldsOf(line).source ?? null, "step"),
    }));
    assert.deepEqual(new Set(sources.map((source) => source.mark)), new Set(["computed"]));
    const fromProve = (count: number): readonly string[] => Array.from({ length: count }, () => "prove");
    assert.deepEqual(
      sources.map((source) => source.step),
      [
        "draw",
        ...fromProve(1),
        "draw",
        ...fromProve(11),
        "draw",
        ...fromProve(12),
        ...Array.from({ length: 7 }, () => "draw"),
      ],
    );
    const asked = jsonOf(await readFile(join(root, ".stand-in/TR2-asked.json"), "utf8"));
    assert.deepEqual(asked, {
      slice: tr2Planned.slice,
      base: git(root, ["rev-parse", "main"]).trim(),
      head: git(root, ["rev-parse", "forge/wip/TR2/1"]).trim(),
      declared: { files: tr2Files, names: noNames },
      bugs: [tr2Bug],
    });
    await decided(root, card, { step: "card", choice: "keep" });
    assert.deepEqual(branches(root), ["forge/TR2", "forge/wip/TR2/1"]);
    assert.deepEqual(worktrees(root), [".forge/worktrees/TR2"]);
    assert.deepEqual(changedOn(root, into), []);
  });

  test("7. the build agent may write under .forge/worktrees/ and nowhere else, and the declare agent writes nothing", async () => {
    const root = await project();
    const manifest = fieldsOf(jsonOf(await readFile(join(root, "components/base/forge/mode.yaml"), "utf8")));
    assert.deepEqual(fieldsOf(fieldsOf(manifest.resources ?? null).files ?? null).write, [".forge/worktrees/"]);
    const built = await bayRan(root, ["build"]);
    assert.equal(built.status, 0, built.stdout);
    const steps = fieldsOf(jsonOf(await readFile(join(root, ".agentbay/steps.json"), "utf8")));
    const agents = fieldsOf(steps.agents ?? null);
    assert.deepEqual(fieldsOf(agents["agentbay-forge-build"] ?? null).write, [join(root, ".forge/worktrees")]);
    assert.deepEqual(fieldsOf(agents["agentbay-forge-declare"] ?? null).write, []);
    assert.deepEqual(fieldsOf(agents["agentbay-forge-build"] ?? null).commands, []);
    const declareTools = fieldsOf(agents["agentbay-forge-declare"] ?? null).tools;
    assert.ok(Array.isArray(declareTools) && !declareTools.includes("Write") && !declareTools.includes("Edit"));
  });

  test("8. carry-out does nothing for a withheld choice, and says so", async () => {
    const root = await project();
    const head = git(root, ["rev-parse", "main"]).trim();
    const request = { name: "A8", branch: "forge/A8", work: "forge/wip/A8/1", head, into };
    for (const choice of ["send-back", "discard"]) {
      const failed = runOf(await bay(root, ["call", "forge.carry-out", JSON.stringify({ choice, ...request })]));
      assert.equal(
        textAt(failed, "reason"),
        `The choice ${choice} is withheld in this slice, so carry-out has nothing to do for it.`,
      );
    }
    assert.deepEqual(branches(root), []);
  });
});
