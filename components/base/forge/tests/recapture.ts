import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { recapturing } from "./kit-copy.ts";

type Capture = {
  readonly into: string;
  readonly before: string;
  readonly commits?: readonly string[];
};

export type Source = {
  readonly file: string;
  readonly test: string;
  readonly name: string;
  readonly anchor: string;
  readonly run: string;
  readonly capture: Omit<Capture, "into">;
};

const kit = join(import.meta.dirname, "../../../..");

const sources: readonly Source[] = [
  {
    file: "given-b1-card.json",
    test: "rounds.test.ts",
    name: "a slice still failing after round 3",
    anchor: 'const card = waitingOf(await shown(root, start.id), "card");',
    run: "start.id",
    capture: { before: "draw" },
  },
  {
    file: "given-r7-failed.json",
    test: "one-round.test.ts",
    name: "7. a must item that failed withholds merge",
    anchor: "const words = wordsOf(card);",
    run: "start.id",
    capture: { before: "draw" },
  },
  {
    file: "given-p2-stopped.json",
    test: "planter.test.ts",
    name: "a builder that stopped gets no planter",
    anchor: 'const card = waitingOf(await shown(root, runId), "card");',
    run: "runId",
    capture: { before: "bugs" },
  },
  {
    file: "given-wave-ca-cb.json",
    test: "wave.test.ts",
    name: "two slices that pass alone but fail the checks combined",
    anchor: "const card = cardOf(await shown(root, start.id));",
    run: "start.id",
    capture: {
      before: "combine",
      commits: ["integration", "forge/CA", "forge/CA-tests-1", "forge/CB", "forge/CB-tests-1"],
    },
  },
];

const gitWords = [
  "-c",
  "user.name=recapture",
  "-c",
  "user.email=recapture@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

const largestRun = 64 * 1024 * 1024;

function run(folder: string, command: string, words: readonly string[]): string {
  return execFileSync(command, words, { cwd: folder, encoding: "utf8", maxBuffer: largestRun });
}

function ranCase(folder: string, test: string, name: string): void {
  const env = { ...process.env, [recapturing]: "1" };
  const words = ["--test", `--test-name-pattern=${name}`, test];
  execFileSync(process.execPath, words, { cwd: folder, env, encoding: "utf8", maxBuffer: largestRun });
}

function jsonValue(value: unknown): Json {
  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonValue(inner)]));
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function textOf(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function stepsBefore(steps: readonly Json[], before: string): Json {
  const top = steps.filter((step) => !/[/[]/.test(textOf(fieldsOf(step).key)));
  const until = top.findIndex((step) => textOf(fieldsOf(step).key) === before);
  const given = top
    .slice(0, until)
    .map((step): [string, Json] => [textOf(fieldsOf(step).key), fieldsOf(step).output ?? null]);
  return Object.fromEntries(given);
}

async function captured(root: string, runId: string, capture: Capture): Promise<void> {
  const shown = jsonValue(JSON.parse(run(root, process.execPath, ["bay/cli.ts", "runs", runId, "--full", "--json"])));
  const steps = fieldsOf(fieldsOf(shown).run ?? null).steps;
  const given = stepsBefore(Array.isArray(steps) ? steps : [], capture.before);
  const branches = capture.commits ?? [];
  const commits = Object.fromEntries(
    branches.map((branch) => [branch, run(root, "git", ["rev-parse", branch]).trim()]),
  );
  const kept = branches.length === 0 ? given : { commits, given };
  await writeFile(capture.into, `${JSON.stringify(kept, null, 2)}\n`, "utf8");
}

export function withCapture(text: string, source: Source, into: string): string {
  const start = text.indexOf(source.name);
  const at = start < 0 ? -1 : text.indexOf(source.anchor, start);
  if (at < 0) {
    throw new Error(`${source.test} has no case "${source.name}" that reads its card with: ${source.anchor}`);
  }
  const capture = JSON.stringify(JSON.stringify({ ...source.capture, into }));
  const words = `[${JSON.stringify(import.meta.filename)}, "--capture", root, ${source.run}, ${capture}]`;
  const line = `(await import("node:child_process")).execFileSync(process.execPath, ${words}, { cwd: root });\n`;
  return `${text.slice(0, at)}${line}    ${text.slice(at)}`;
}

async function kitCopy(): Promise<string> {
  const copy = await realpath(await mkdtemp(join(tmpdir(), "agentbay-recapture-")));
  const listed = run(kit, "git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0");
  for (const path of listed.filter((each) => each !== "")) {
    await mkdir(dirname(join(copy, path)), { recursive: true });
    await cp(join(kit, path), join(copy, path));
  }
  await symlink(await realpath(join(kit, "node_modules")), join(copy, "node_modules"));
  run(copy, "git", ["init", "-q"]);
  await writeFile(join(copy, ".git/info/exclude"), "node_modules\n", "utf8");
  run(copy, "git", [...gitWords, "add", "-A"]);
  run(copy, "git", [...gitWords, "commit", "-q", "-m", "The kit to recapture from"]);
  return copy;
}

export function askedFiles(wanted: readonly string[]): readonly string[] {
  const known = sources.map((source) => source.file);
  const unknown = wanted.filter((file) => !known.includes(file));
  if (unknown.length > 0) {
    throw new Error(`recapture makes only ${known.join(", ")}; it has no case for ${unknown.join(", ")}.`);
  }
  return wanted.length === 0 ? known : wanted;
}

export function notRemade(asked: readonly string[], written: readonly string[]): string | undefined {
  const missing = asked.filter((file) => !written.includes(file));
  return missing.length === 0
    ? undefined
    : `recapture did not write ${missing.join(", ")}: its case was skipped or never reached the capture, so the ` +
        "file is as it was.";
}

export async function recaptured(copy: string, source: Source): Promise<readonly string[]> {
  const test = join(copy, "components/base/forge/tests", source.test);
  const into = join(copy, "recaptured", source.file);
  await mkdir(dirname(into), { recursive: true });
  await writeFile(test, withCapture(await readFile(test, "utf8"), source, into), "utf8");
  ranCase(copy, test, source.name);
  if (!existsSync(into)) {
    return [];
  }
  await cp(into, join(import.meta.dirname, source.file));
  process.stdout.write(`recaptured ${source.file} from ${source.test}: ${source.name}\n`);
  return [source.file];
}

export async function recapturedIn(copy: string, chosen: readonly Source[]): Promise<void> {
  const written: string[] = [];
  for (const source of chosen) {
    written.push(...(await recaptured(copy, source)));
  }
  const files = written.map((file) => join(import.meta.dirname, file));
  if (files.length > 0) {
    run(kit, "npx", ["prettier", "--config", "components/base/typescript/prettier.json", "--write", ...files]);
  }
  const missing = notRemade(
    chosen.map((source) => source.file),
    written,
  );
  if (missing !== undefined) {
    throw new Error(missing);
  }
}

async function recapturedAll(wanted: readonly string[]): Promise<void> {
  const asked = askedFiles(wanted);
  const copy = await kitCopy();
  try {
    await recapturedIn(
      copy,
      sources.filter((each) => asked.includes(each.file)),
    );
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
}

async function main(words: readonly string[]): Promise<void> {
  const [first, root = "", runId = "", capture = "{}"] = words;
  if (first !== "--capture") {
    await recapturedAll(words);
    return;
  }
  const asked = fieldsOf(jsonValue(JSON.parse(capture)));
  const commits = Array.isArray(asked.commits) ? asked.commits.map(textOf) : undefined;
  const wanted = { into: textOf(asked.into), before: textOf(asked.before) };
  await captured(root, runId, commits === undefined ? wanted : { ...wanted, commits });
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
