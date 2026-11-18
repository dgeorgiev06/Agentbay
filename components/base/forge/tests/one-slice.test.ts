import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";

type Answer = { readonly verdict: "approve" | "reject" } | { readonly choice: string };

type Waiting = {
  readonly id: string;
  readonly hash: string;
  readonly card: Json;
  readonly choices: Json;
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

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const standIn = "components/modes/proof-stand-in";

const into = "integration";

const practices = ["framework/practices.md", "components/base/typescript/practices.md"];

const noNames = { gained: [], lost: [], changed: [] };

const testAuthor = ["-c", "user.name=forge test", "-c", "user.email=forge-test@example.invalid"];

let copy: string;

let checkedOut: string;

const standInManifest = [
  "name: proof-stand-in",
  "version: 1.0.0",
  "description: A stand-in for proof in forge's own test; it answers the verdicts the test wrote for the slice.",
  "implements: [proof@1]",
  "resources:",
  "  files: { read: [.stand-in/] }",
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
  '  const read = await context.files.read(`.stand-in/${String(name)}.json`);',
  "  return read.ok ? JSON.parse(read.value) : fail(read.message);",
  "});",
  "",
].join("\n");

function git(words: readonly string[]): string {
  return execFileSync("git", [...testAuthor, "-c", "commit.gpgsign=false", ...words], { cwd: copy, encoding: "utf8" });
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
    settings: { ...settings, forge: { ...fieldsOf(settings.forge ?? null), into, practices } },
  });
}

async function copyOfTheKit(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "agentbay-one-slice-")));
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
  return folder;
}

before(async () => {
  copy = await copyOfTheKit();
  git(["init", "-q", "--initial-branch=main"]);
  git(["add", "-f", "--pathspec-from-file=.git-files", "--pathspec-file-nul"]);
  git(["commit", "-q", "-m", "The kit as the test found it"]);
  git(["branch", into]);
  await rm(join(copy, ".git-files"));
  await symlink(await realpath(join(kit, "node_modules")), join(copy, "node_modules"));
  checkedOut = git(["rev-parse", "HEAD"]).trim();
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

function bayRan(words: readonly string[]): { readonly status: number | null; readonly stdout: string } {
  const ran = spawnSync(process.execPath, ["bay/cli.ts", ...words], { cwd: copy, encoding: "utf8" });
  return { status: ran.status, stdout: ran.stdout };
}

function bay(words: readonly string[]): Json {
  return jsonOf(bayRan([...words, "--json"]).stdout);
}

function runOf(answer: Json): Json {
  return fieldsOf(answer).run ?? null;
}

function stateOf(run: Json): string {
  const status = fieldsOf(run).status;
  return typeof status === "string" ? status : "";
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

function started(planned: Planned, base: string): Waiting {
  const trigger = { planned, base, bugs: [] };
  return waitingOf(runOf(bay(["call", "--workflow", "forge:workflows/one-slice.yaml", JSON.stringify(trigger)])), "start");
}

function decisionWords(waiting: Waiting, step: string, answer: Answer): readonly string[] {
  const asked = "choice" in answer ? ["--choice", answer.choice] : answer.verdict === "reject" ? ["--reject"] : [];
  return ["approve", waiting.id, step, "--hash", waiting.hash, ...asked, "--via", "chat", "--quote", "as the owner"];
}

function decided(waiting: Waiting, step: string, answer: Answer): Json {
  return runOf(bay(decisionWords(waiting, step, answer)));
}

function submitted(runId: string, output: Json): Json {
  const task = fieldsOf(runOf(bay(["runs", runId, "--new-token"]))).task ?? null;
  return runOf(bay(["submit", JSON.stringify(output), "--token", textAt(task, "token")]));
}

function cardText(runId: string): readonly string[] {
  const lines = bayRan(["runs", runId]).stdout.split("\n");
  const end = lines.findIndex((line) => line.startsWith("decide with:"));
  return lines.slice(1, end);
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

function provedIn(name: string, proved: Proved): Promise<void> {
  return mkdir(join(copy, ".stand-in"), { recursive: true }).then(() =>
    writeFile(join(copy, ".stand-in", `${name}.json`), JSON.stringify(proved), "utf8"),
  );
}

async function builderWrites(name: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const path = join(copy, ".forge/worktrees", name, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `Written by the builder of ${name}.\n`, "utf8");
  }
}

function branches(name: string): readonly string[] {
  const listed = git(["branch", "--list", "--format=%(refname:short)", `forge/${name}`, `forge/${name}-*`, `forge/wip/${name}/*`]);
  return listed.split("\n").filter((line) => line !== "");
}

function worktrees(name: string): readonly string[] {
  const listed = git(["worktree", "list", "--porcelain"]).split("\n");
  const folders = listed.filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  const prefix = join(copy, ".forge/worktrees", name);
  return folders.filter((folder) => folder === prefix || folder.startsWith(`${prefix}-`)).map((folder) => folder.slice(copy.length + 1));
}

function integrationHolds(name: string): readonly string[] {
  return git(["ls-tree", "-r", "--name-only", into])
    .split("\n")
    .filter((path) => path.includes(`/${name.toLowerCase()}/`));
}

function cardLines(waiting: Waiting): readonly Json[] {
  const lines = fieldsOf(waiting.card).lines;
  return Array.isArray(lines) ? lines : [];
}

function wordsOf(waiting: Waiting): readonly string[] {
  return cardLines(waiting).map((line) => textAt(line, "words"));
}

function base(): string {
  return git(["rev-parse", "--short=7", "main"]).trim();
}

async function builtToCard(waiting: Waiting, build: { readonly name: string; readonly files: readonly string[]; readonly built: Json }): Promise<Waiting> {
  const declared = decided(waiting, "start", { verdict: "approve" });
  assert.equal(stateOf(declared), "waiting");
  submitted(waiting.id, { files: [...build.files], names: noNames });
  await builderWrites(build.name, build.files);
  return waitingOf(submitted(waiting.id, build.built), "card");
}

test("1. every verdict passed: merge is offered, and taking it merges the builder's files into a branch nobody has checked out", async () => {
  const files = ["docs/a1/notes.md", "components/base/a1/mode.yaml"];
  const slice = planned("A1", ["docs/a1/**", "components/base/a1/**"], [item("DOD-A1-1", "must", "checks")]);
  await provedIn("A1", {
    verdicts: [passed("DOD-A1-1", "checks"), passed("scope", "in-scope"), passed("declared", "as-declared")],
    judgement: [],
    size: [{ path: files[0] ?? "", head: 1 }, { path: files[1] ?? "", head: 1 }],
  });
  const card = await builtToCard(started(slice, base()), { name: "A1", files, built: { outcome: "built" } });
  assert.deepEqual(card.choices, [
    { name: "merge", status: "offered", does: "Merge into the integration branch" },
    { name: "send-back", status: "withheld", does: "Round 2, a fresh builder", reason: "rounds come with slice F2." },
    { name: "keep", status: "offered", does: "Stop; the branches stay" },
    { name: "discard", status: "withheld", does: "Stop; the worktree goes", reason: "discarding comes with slice WD1." },
  ]);
  assert.ok(wordsOf(card).includes("base mode manifest changed, its list needs no trust: components/base/a1/mode.yaml"));
  const done = decided(card, "card", { choice: "merge" });
  const head = git(["rev-parse", into]).trim();
  assert.deepEqual(fieldsOf(done).output, { choice: "merge", merged: head, into });
  assert.deepEqual(branches("A1"), ["forge/A1", "forge/A1-merge", "forge/wip/A1/1"]);
  assert.deepEqual(worktrees("A1"), [".forge/worktrees/A1", ".forge/worktrees/A1-merge"]);
  assert.deepEqual(integrationHolds("A1"), ["components/base/a1/mode.yaml", "docs/a1/notes.md"]);
  assert.equal(git(["show", `${into}:docs/a1/notes.md`]), "Written by the builder of A1.\n");
  assert.equal(git(["rev-parse", "HEAD"]).trim(), checkedOut);
  assert.equal(git(["symbolic-ref", "--short", "HEAD"]).trim(), "main");
});
