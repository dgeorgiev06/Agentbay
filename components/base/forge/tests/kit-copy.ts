import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { commandLineIn, type CommandLineIn } from "../../../../tests/test-toolbox.ts";
import { requirementsFile, todoVersionOne } from "./todo-plan.ts";

export type Waiting = {
  readonly id: string;
  readonly hash: string;
  readonly card: Json;
  readonly choices: Json;
};

export type Answer = { readonly verdict: "approve" | "reject" } | { readonly choice: string };

export type Proved = {
  readonly verdicts: readonly Json[];
  readonly judgement: readonly Json[];
  readonly size: readonly Json[];
};

type Ran = {
  readonly status: number | null;
  readonly stdout: string;
};

export const into = "integration";

export const recapturing = "FORGE_RECAPTURE";

export const onlyWhenRecapturing = {
  skip:
    process.env[recapturing] === undefined ? `runs only when ${recapturing} is set, as recapture.ts sets it` : false,
};

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const standIn = "components/modes/proof-stand-in";

const practices = ["framework/practices.md", "components/base/typescript/practices.md"];

const gitWords = [
  "-c",
  "user.name=forge test",
  "-c",
  "user.email=forge-test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

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
  "  const name = String(fieldsOf(fieldsOf(input).slice ?? null).name);",
  "  const before = await context.files.read(`.stand-in/${name}-asked.json`);",
  "  const asked = before.ok ? JSON.parse(before.value) : [];",
  "  const written = await context.files.write(`.stand-in/${name}-asked.json`, JSON.stringify([...asked, input]));",
  "  if (!written.ok) {",
  "    fail(written.message);",
  "  }",
  "  const done = fieldsOf(fieldsOf(input).slice ?? null).done;",
  "  const kinds = (Array.isArray(done) ? done : []).map((item) => fieldsOf(fieldsOf(item).proof ?? null).kind);",
  '  const asKinds = await context.files.read(`.stand-in/${name}.${[...new Set(kinds)].sort().join("-")}.json`);',
  "  const read = asKinds.ok ? asKinds : await context.files.read(`.stand-in/${name}.json`);",
  "  return read.ok ? JSON.parse(read.value) : fail(read.message);",
  "});",
  "",
].join("\n");

const roots: string[] = [];

const commandLines = new Map<string, Promise<CommandLineIn>>();

const rootsRunByProcess = new Set<string>();

export function git(root: string, words: readonly string[]): string {
  return execFileSync("git", [...gitWords, ...words], { cwd: root, encoding: "utf8" });
}

function kitFiles(): readonly string[] {
  const listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: kit });
  return listing
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "");
}

export function jsonOf(text: string): Json {
  const read = readYaml(text);
  assert.ok(read.ok, text);
  return read.value;
}

async function configForTheTest(forge: Json): Promise<string> {
  const config = fieldsOf(jsonOf(await readFile(join(kit, "agentbay.config.yaml"), "utf8")));
  const settings = fieldsOf(config.settings ?? null);
  return JSON.stringify({
    ...config,
    bindings: { ...fieldsOf(config.bindings ?? null), proof: "proof-stand-in" },
    approvals: { from: ["terminal", "chat"] },
    skillSteps: { run: "without-the-hook" },
    settings: { ...settings, forge: { ...fieldsOf(settings.forge ?? null), into, practices, ...fieldsOf(forge) } },
  });
}

async function madeFolder(prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(folder);
  return folder;
}

export async function kitTemplate(forge: Json = {}): Promise<string> {
  const folder = await madeFolder("agentbay-rounds-");
  const files = kitFiles();
  for (const path of files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await cp(join(kit, path), join(folder, path));
  }
  await cp(todoVersionOne, join(folder, requirementsFile));
  await writeFile(join(folder, "agentbay.config.yaml"), await configForTheTest(forge), "utf8");
  await mkdir(join(folder, standIn, "scripts"), { recursive: true });
  await writeFile(join(folder, standIn, "mode.yaml"), standInManifest, "utf8");
  await writeFile(join(folder, standIn, "scripts/prove.ts"), standInScript, "utf8");
  const listed = [...files, `${standIn}/mode.yaml`, `${standIn}/scripts/prove.ts`];
  await writeFile(join(folder, ".git-files"), listed.join("\0"), "utf8");
  git(folder, ["init", "-q", "--initial-branch=main"]);
  git(folder, ["add", "-f", "--pathspec-from-file=.git-files", "--pathspec-file-nul"]);
  git(folder, ["commit", "-q", "-m", "The kit as the test found it"]);
  return folder;
}

export async function removeAll(): Promise<void> {
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
  }
  commandLines.clear();
  rootsRunByProcess.clear();
}

export async function project(template: string): Promise<string> {
  const root = await madeFolder("agentbay-rounds-case-");
  git(root, ["clone", "-q", template, "."]);
  git(root, ["branch", into]);
  await symlink(await realpath(join(kit, "node_modules")), join(root, "node_modules"));
  return root;
}

export function byProcess(root: string): string {
  rootsRunByProcess.add(root);
  return root;
}

export async function processProject(template: string): Promise<string> {
  return byProcess(await project(template));
}

async function inProcessRan(root: string, words: readonly string[]): Promise<Ran> {
  const commandLine = commandLines.get(root) ?? commandLineIn(root);
  commandLines.set(root, commandLine);
  const ran = await (await commandLine)(words);
  return { status: ran.exitCode, stdout: `${ran.output}\n` };
}

export function bayRan(root: string, words: readonly string[]): Promise<Ran> {
  return rootsRunByProcess.has(root) ? processRan(root, words) : inProcessRan(root, words);
}

function processRan(root: string, words: readonly string[]): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bay/cli.ts", ...words], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

export async function bay(root: string, words: readonly string[]): Promise<Json> {
  return jsonOf((await bayRan(root, [...words, "--json"])).stdout);
}

export function runOf(answer: Json): Json {
  return fieldsOf(answer).run ?? null;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

export function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

export function textAt(value: Json, key: string): string {
  const found = fieldsOf(value)[key];
  return typeof found === "string" ? found : "";
}

export function waitingOf(run: Json, step: string): Waiting {
  const waiting = fieldsOf(run).waiting ?? null;
  assert.equal(textAt(waiting, "stepKey"), step, JSON.stringify(run));
  const { card = null, choices = null } = fieldsOf(waiting);
  return { id: textAt(run, "id"), hash: textAt(waiting, "hash"), card, choices };
}

export function shortHead(root: string): string {
  return git(root, ["rev-parse", "--short=7", "main"]).trim();
}

export async function started(root: string, trigger: Json): Promise<Waiting> {
  const answer = await bay(root, ["call", "--workflow", "forge:workflows/rounds.yaml", JSON.stringify(trigger)]);
  return waitingOf(runOf(answer), "start");
}

function answerWords(answer: Answer): readonly string[] {
  if ("choice" in answer) {
    return ["--choice", answer.choice];
  }
  return answer.verdict === "reject" ? ["--reject"] : [];
}

export async function decided(
  root: string,
  waiting: Waiting,
  answer: Answer & { readonly step: string },
): Promise<Json> {
  const words = ["approve", waiting.id, answer.step, "--hash", waiting.hash, ...answerWords(answer)];
  return bay(root, [...words, "--via", "chat", "--quote", "as the owner"]);
}

export async function ownerAnswered(root: string, runId: string, answer: "--rerun" | "--stop"): Promise<Json> {
  return bay(root, ["resume", runId, answer, "--via", "chat", "--quote", "as the owner"]);
}

export async function printedCard(root: string, runId: string, heading = "Merge "): Promise<readonly string[]> {
  const widest = 44;
  const printed = (await bayRan(root, ["runs", runId])).stdout.split("\n");
  const first = printed.findIndex((line) => line.startsWith(heading));
  const last = printed.findIndex((line) => line.startsWith("hash "));
  const card = printed.slice(first, last);
  assert.ok(
    card.every((line) => Array.from(line).length <= widest),
    card.join("\n"),
  );
  return card;
}

export type Fact = {
  readonly section: string;
  readonly short: boolean;
  readonly about: string;
  readonly mark: string;
  readonly words: string;
  readonly step: string;
};

export function factOf(line: Json): Fact {
  const fields = fieldsOf(line);
  return {
    section: textAt(line, "section"),
    short: fields.short === true,
    about: textAt(line, "about"),
    mark: textAt(line, "mark"),
    words: textAt(line, "words"),
    step: textAt(fields.source ?? null, "step"),
  };
}

export function factsOf(waiting: Waiting, section?: string): readonly Fact[] {
  const facts = listOf(fieldsOf(waiting.card).lines).map(factOf);
  return section === undefined ? facts : facts.filter((fact) => fact.section === section);
}

export function offeredOf(waiting: Waiting): readonly string[] {
  return listOf(waiting.choices)
    .filter((choice) => textAt(choice, "status") === "offered")
    .map((choice) => textAt(choice, "name"));
}

export function withheldOf(waiting: Waiting): Readonly<Record<string, string>> {
  const withheld = listOf(waiting.choices).filter((choice) => textAt(choice, "status") === "withheld");
  return Object.fromEntries(withheld.map((choice) => [textAt(choice, "name"), textAt(choice, "reason")]));
}

export async function shown(root: string, runId: string): Promise<Json> {
  return runOf(await bay(root, ["runs", runId]));
}

export async function actionOutputs(root: string, runId: string, action: string): Promise<readonly Json[]> {
  const run = runOf(await bay(root, ["runs", runId, "--full"]));
  const steps = listOf(fieldsOf(run).steps).filter((each) => textAt(each, "kind") === "action");
  const asked = steps.filter((each) => textAt(fieldsOf(each).detail ?? null, "action") === action);
  return asked.map((each) => fieldsOf(each).output ?? null);
}

export async function task(root: string, runId: string): Promise<Json> {
  return fieldsOf(await shown(root, runId)).task ?? null;
}

async function reissued(root: string, runId: string): Promise<Json> {
  return runOf(await bay(root, ["runs", runId, "--new-token"]));
}

function submittedWith(root: string, given: Json, output: Json): Promise<Json> {
  return bay(root, ["submit", JSON.stringify(output), "--token", textAt(given, "token")]);
}

export async function answered(root: string, runId: string, output: Json): Promise<Json> {
  return submittedWith(root, fieldsOf(await reissued(root, runId)).task ?? null, output);
}

export async function submitted(root: string, runId: string, output: Json): Promise<Json> {
  return runOf(await answered(root, runId, output));
}

export async function provedIn(root: string, name: string, proved: Proved): Promise<void> {
  await mkdir(join(root, ".stand-in"), { recursive: true });
  await writeFile(join(root, ".stand-in", `${name}.json`), JSON.stringify(proved), "utf8");
}

export async function askedOf(root: string, name: string): Promise<readonly Json[]> {
  return listOf(jsonOf(await readFile(join(root, ".stand-in", `${name}-asked.json`), "utf8")));
}

export async function builderWrites(root: string, folder: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const path = join(root, folder, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `Written by the builder in ${folder}.\n`, "utf8");
  }
}

export function branches(root: string): readonly string[] {
  const listed = git(root, ["branch", "--list", "--format=%(refname:short)", "forge/*"]);
  return listed.split("\n").filter((line) => line !== "");
}

export function worktrees(root: string): readonly string[] {
  const listed = git(root, ["worktree", "list", "--porcelain"]).split("\n");
  const folders = listed.filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
  return folders.filter((folder) => folder !== root).map((folder) => folder.slice(root.length + 1));
}

export function assertTheMainCheckoutIsUntouched(root: string): void {
  assert.equal(git(root, ["symbolic-ref", "--short", "HEAD"]).trim(), "main");
  assert.equal(git(root, ["rev-parse", "main"]).trim(), git(root, ["rev-parse", "origin/main"]).trim());
  assert.equal(git(root, ["status", "--porcelain", "--untracked-files=no"]), "");
}

async function filesUnder(root: string, folder: string): Promise<readonly string[]> {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(root, path)));
    } else if (entry.isFile()) {
      found.push(path);
    }
  }
  return found;
}

function linesOf(texts: readonly string[]): readonly string[] {
  const lines = texts.flatMap((text) => text.split("\n").map((line) => line.trim()));
  return [...new Set(lines.filter((line) => line !== ""))];
}

function formsOf(line: string): readonly string[] {
  return [line, JSON.stringify(line).slice(1, -1)];
}

export async function filesHolding(root: string, folder: string, texts: readonly string[]): Promise<readonly string[]> {
  const forms = linesOf(texts).flatMap(formsOf);
  const holding: string[] = [];
  for (const path of await filesUnder(root, folder)) {
    const text = (await readFile(join(root, path))).toString("latin1");
    const bytes = forms.map((form) => Buffer.from(form, "utf8").toString("latin1"));
    if (bytes.some((form) => text.includes(form))) {
      holding.push(path);
    }
  }
  return holding.sort();
}

export type Handed = {
  readonly path: string;
  readonly text: string;
};

export type Played = (task: Json) => Promise<Json>;

export type Players = {
  readonly tests?: Played;
  readonly builder?: Played;
  readonly reviewer?: Played;
  readonly planter?: Played;
  readonly designer?: Played;
  readonly challenger?: Played;
  readonly planner?: Played;
  readonly planChallenger?: Played;
  readonly declarer?: Played;
};

export type Asked = {
  readonly action: string;
  readonly step: string;
  readonly task: Json;
};

export function actionOf(task: Json): string {
  return textAt(task, "agent").replace(/^agentbay-forge-/, "");
}

export function playerOf(players: Players, action: string): Played | undefined {
  switch (action) {
    case "write-tests":
      return players.tests;
    case "build-without-tests":
      return players.builder;
    case "review":
      return players.reviewer;
    case "plant":
      return players.planter;
    case "design":
      return players.designer;
    case "challenge":
      return players.challenger;
    case "plan":
      return players.planner;
    case "challenge-plan":
      return players.planChallenger;
    case "declare":
      return players.declarer;
    default:
      throw new Error(`No player answers the action ${action}.`);
  }
}

export async function playedTo(root: string, runId: string, players: Players): Promise<readonly Asked[]> {
  const asked: Asked[] = [];
  for (;;) {
    const run = await reissued(root, runId);
    const waiting = fieldsOf(run).waiting ?? null;
    if (textAt(run, "status") !== "waiting" || textAt(waiting, "reason") !== "skill") {
      return asked;
    }
    const given = fieldsOf(run).task ?? null;
    const action = actionOf(given);
    const player = playerOf(players, action);
    if (player === undefined) {
      return asked;
    }
    asked.push({ action, step: textAt(given, "stepKey"), task: given });
    const answer = await submittedWith(root, given, await player(given));
    const ended = ["undone", "failed"].includes(textAt(runOf(answer), "status"));
    if (fieldsOf(answer).ok !== true && !ended) {
      throw new Error(`The kernel did not take the output of ${action}: ${JSON.stringify(answer)}`);
    }
  }
}

export function caseNamesIn(task: Json): readonly string[] {
  const tests = listOf(fieldsOf(fieldsOf(task).input ?? null).tests);
  const names = tests.flatMap((entry) => [...textAt(entry, "text").matchAll(/test\("([^"]+)"/g)]);
  return names.map((found) => found[1] ?? "");
}

export type NotHeldAnswer = {
  readonly id: string;
  readonly path: string;
  readonly sentence: string;
};

export function practicesAnswered(task: Json, notHeld: readonly NotHeldAnswer[] = []): readonly Json[] {
  const given = listOf(fieldsOf(fieldsOf(task).input ?? null).practices).map((practice) => textAt(practice, "id"));
  return given.map((id) => {
    const breaking = notHeld.find((answer) => answer.id === id);
    return breaking === undefined
      ? { id, answer: "held", sentence: "The round's code and tests hold it." }
      : { ...breaking, answer: "not-held" };
  });
}

export function allHeld(task: Json): Json {
  const slice = fieldsOf(fieldsOf(task).input ?? null).slice ?? null;
  const [first = ""] = caseNamesIn(task);
  const items = listOf(fieldsOf(slice).done).map((item) => textAt(item, "id"));
  const conditions = items.map((item) => ({ item, held: true, cases: [first] }));
  return { conditions, findings: [], practices: [...practicesAnswered(task)] };
}

export type RoundPlan = {
  readonly name: string;
  readonly files: readonly string[];
  readonly tests: readonly Handed[];
  readonly built: Json;
  readonly whileWriting?: (runId: string) => Promise<void>;
  readonly whileBuilding?: (runId: string) => Promise<void>;
};

const noNames = { gained: [], lost: [], changed: [] };

export function goAhead(start: Waiting): string {
  const offered = listOf(start.choices).filter((choice) => textAt(choice, "status") === "offered");
  return offered.map((choice) => textAt(choice, "name")).find((name) => name !== "stop") ?? "";
}

export async function begun(root: string, start: Waiting): Promise<Json> {
  return decided(root, start, { step: "start", choice: goAhead(start) });
}

export async function declared(root: string, start: Waiting, files: readonly string[]): Promise<void> {
  await begun(root, start);
  const answered = await submitted(root, start.id, { files: [...files], names: noNames });
  assert.equal(textAt(answered, "status"), "waiting", JSON.stringify(answered));
}

export async function roundToCard(root: string, start: Waiting, plan: RoundPlan): Promise<Waiting> {
  await declared(root, start, plan.files);
  await playedTo(root, start.id, {
    tests: async () => {
      await plan.whileWriting?.(start.id);
      return { tests: [...plan.tests] };
    },
    builder: async (given) => {
      await builderWrites(root, textAt(fieldsOf(given).input ?? null, "folder"), plan.files);
      await plan.whileBuilding?.(start.id);
      return plan.built;
    },
    reviewer: (given) => Promise.resolve(allHeld(given)),
  });
  return waitingOf(await shown(root, start.id), "card");
}

export function keptRows(root: string): readonly Json[] {
  const file = join(root, ".agentbay/data/forge--kept-tests.db");
  if (!existsSync(file)) {
    return [];
  }
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database.prepare("select slice, path, packed from kept_tests order by slice, path").all();
    return rows.map((row) => ({ slice: String(row.slice), path: String(row.path), packed: String(row.packed) }));
  } finally {
    database.close();
  }
}
