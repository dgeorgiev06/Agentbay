import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";

import type { ModeFiles } from "./kit-copy.ts";
import { kit } from "./project-fixture.ts";

export type ProofVariant =
  | "proves by the interface"
  | "reports passed for an inconclusive check"
  | "gives the toolchain a worktree"
  | "leaves a copy behind when the toolchain fails"
  | "passes a bug that survives"
  | "puts a declared path into a detail"
  | "omits the two added items when every item is judgement"
  | "counts a bug that could not be applied as caught"
  | "counts a bug whose tests did not load as caught"
  | "reads a cut output of a command as whole";

type Replacement = readonly [file: string, line: string, wrong: string];

const sdkFromScripts = "../../../../bay/sdk.ts";

const sdkFromLibrary = "../../../../../bay/sdk.ts";

const settingsSchema = readFileSync(join(kit, "components/base/interfaces/proof/settings.json"), "utf8");

const effectsOfAProof = ["read", "write", "network", "spend", "delete"];

function lines(...texts: readonly string[]): string {
  return `${texts.join("\n")}\n`;
}

function manifestOf(name: string): string {
  return stringify({
    name,
    version: "1.0.0",
    description:
      "Proves a slice's items by script through a toolchain and a worktrees mode; a proof@1 that a test adds to a copy of the kit.",
    implements: ["proof@1"],
    requires: { interfaces: ["toolchain@1", "worktrees@1"] },
    settings: "schemas/settings.json",
    resources: {
      commands: {
        "count-lines": { run: "wc -l --", effects: ["read"] },
        "count-matches": { run: "grep -r -c -H -F -e", effects: ["read"] },
        print: { run: "cat --", effects: ["read"] },
        bay: { run: "./bay.sh", effects: ["read", "write"] },
      },
    },
    actions: {
      prove: {
        description: "When a test needs a slice's items proved, with a verdict for each.",
        effects: effectsOfAProof,
        run: [{ script: "scripts/prove.ts" }],
      },
    },
  });
}

const requestLibrary = String.raw`import { fieldsOf, type Json, type JsonFields } from "${sdkFromLibrary}";

export type Count =
  | { readonly of: "most"; readonly pattern: string; readonly paths: readonly string[]; readonly most: number }
  | { readonly of: "no rise"; readonly pattern: string; readonly paths: readonly string[] }
  | { readonly of: "declared"; readonly name: string };

export type Command =
  | { readonly through: "bay"; readonly words: readonly string[] }
  | { readonly through: "toolchain"; readonly name: string; readonly arguments: readonly string[] };

export type Run = { readonly command: Command; readonly stdout: string; readonly exitCode: number };

export type Proof =
  | { readonly kind: "checks" }
  | { readonly kind: "fails-first"; readonly tests: readonly string[] }
  | { readonly kind: "bugs-caught" }
  | { readonly kind: "same-output"; readonly differ: readonly string[] }
  | { readonly kind: "count"; readonly count: Count }
  | { readonly kind: "real-thing"; readonly runs: readonly Run[] };

export type ProvenItem = { readonly id: string; readonly proof: Proof };

export type Bug = { readonly name: string; readonly patch: string; readonly tests: readonly string[] };

export type Names = { readonly gained: readonly string[]; readonly lost: readonly string[]; readonly changed: readonly string[] };

export type DeclaredCommand = { readonly name: string; readonly command: Command };

export type DeclaredCount = { readonly name: string; readonly pattern: string; readonly paths: readonly string[] };

export type Request = {
  readonly base: string;
  readonly head: string;
  readonly scope: readonly string[];
  readonly proven: readonly ProvenItem[];
  readonly judgement: readonly Json[];
  readonly files: readonly string[];
  readonly names: Names;
  readonly bugs: readonly Bug[];
  readonly sameOutput: readonly DeclaredCommand[];
  readonly noRise: readonly DeclaredCount[];
};

function text(fields: JsonFields, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : "";
}

function texts(fields: JsonFields, name: string): readonly string[] {
  const value = fields[name];
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function number(fields: JsonFields, name: string): number {
  const value = fields[name];
  return typeof value === "number" ? value : 0;
}

function records(fields: JsonFields, name: string): readonly JsonFields[] {
  const value = fields[name];
  return Array.isArray(value) ? value.map(fieldsOf) : [];
}

function commandOf(fields: JsonFields): Command {
  return typeof fields.run === "string"
    ? { through: "toolchain", name: fields.run, arguments: texts(fields, "arguments") }
    : { through: "bay", words: texts(fields, "bay") };
}

function countOf(fields: JsonFields): Count {
  if (typeof fields.use === "string") {
    return { of: "declared", name: fields.use };
  }
  const counted = { pattern: text(fields, "pattern"), paths: texts(fields, "paths") };
  return fields.noRise === true ? { of: "no rise", ...counted } : { of: "most", ...counted, most: number(fields, "most") };
}

function proofOf(fields: JsonFields): Proof {
  const kind = text(fields, "kind");
  switch (kind) {
    case "fails-first":
      return { kind, tests: texts(fields, "tests") };
    case "same-output":
      return { kind, differ: texts(fields, "differ") };
    case "count":
      return { kind, count: countOf(fields) };
    case "real-thing":
      return {
        kind,
        runs: records(fields, "runs").map((run) => ({ command: commandOf(run), stdout: text(run, "stdout"), exitCode: number(run, "exitCode") })),
      };
    case "bugs-caught":
      return { kind };
    default:
      return { kind: "checks" };
  }
}

export function requestOf(input: Json, settings: Readonly<Record<string, Json>>): Request {
  const fields = fieldsOf(input);
  const slice = fieldsOf(fields.slice ?? null);
  const done = Array.isArray(slice.done) ? slice.done : [];
  const declared = fieldsOf(fields.declared ?? null);
  const names = fieldsOf(declared.names ?? null);
  return {
    base: text(fields, "base"),
    head: text(fields, "head"),
    scope: texts(slice, "scope"),
    proven: done.map(fieldsOf).flatMap((item) =>
      item.proof === undefined ? [] : [{ id: text(item, "id"), proof: proofOf(fieldsOf(item.proof)) }],
    ),
    judgement: done.filter((item) => fieldsOf(item).proof === undefined),
    files: texts(declared, "files"),
    names: { gained: texts(names, "gained"), lost: texts(names, "lost"), changed: texts(names, "changed") },
    bugs: records(fields, "bugs").map((bug) => ({ name: text(bug, "name"), patch: text(bug, "patch"), tests: texts(bug, "tests") })),
    sameOutput: records(settings, "sameOutput").map((command) => ({ name: text(command, "name"), command: commandOf(command) })),
    noRise: records(settings, "noRise").map((count) => ({
      name: text(count, "name"),
      pattern: text(count, "pattern"),
      paths: texts(count, "paths"),
    })),
  };
}
`;

const verdictsLibrary = String.raw`import type { Cases } from "./calls.ts";

export type Kind = "checks" | "fails-first" | "in-scope" | "as-declared" | "bugs-caught" | "same-output" | "count" | "real-thing";

export type Part =
  | { readonly verdict: "passed" }
  | { readonly verdict: "failed"; readonly why: string; readonly cases?: Cases }
  | { readonly verdict: "inconclusive"; readonly reason: string };

export type Verdict =
  | { readonly item: string; readonly kind: Kind; readonly verdict: "passed"; readonly detail: string }
  | { readonly item: string; readonly kind: Kind; readonly verdict: "failed"; readonly detail: string; readonly cases?: Cases }
  | { readonly item: string; readonly kind: Kind; readonly verdict: "inconclusive"; readonly reason: string };

export const held: Part = { verdict: "passed" };

export function broken(why: string): Part {
  return { verdict: "failed", why };
}

export function brokenShowing(why: string, cases: Cases): Part {
  return { verdict: "failed", why, cases };
}

export function unknown(reason: string): Part {
  return { verdict: "inconclusive", reason };
}

export function decided(item: string, kind: Kind, parts: readonly Part[], summary: string): Verdict {
  for (const part of parts) {
    if (part.verdict === "inconclusive") {
      return { item, kind, verdict: "inconclusive", reason: part.reason };
    }
  }
  const failed = parts.flatMap((part) => (part.verdict === "failed" ? [part] : []));
  if (failed.length > 0) {
    const detail = failed.map((part) => part.why).join(" ");
    const cases = failed.find((part) => part.cases !== undefined)?.cases;
    return cases === undefined ? { item, kind, verdict: "failed", detail } : { item, kind, verdict: "failed", detail, cases };
  }
  return { item, kind, verdict: "passed", detail: summary };
}

export function counted(count: number, one: string, many: string): string {
  return String(count) + " " + (count === 1 ? one : many);
}
`;

const callsLibrary = String.raw`import { fieldsOf, type Json, type ScriptContext } from "${sdkFromLibrary}";

export type Called = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly reason: string };

export type Copy = { readonly made: true; readonly folder: string } | { readonly made: false; readonly reason: string };

export type Ended =
  | { readonly how: "exited"; readonly exitCode: number; readonly stdout: string }
  | { readonly how: "unknown"; readonly reason: string };

export type Cases = { readonly [field: string]: Json };

export type TestRun =
  | { readonly verdict: "passed"; readonly passed: number }
  | { readonly verdict: "failed"; readonly failed: number; readonly cases: Cases }
  | { readonly verdict: "inconclusive"; readonly reason: string };

const commandSeconds = 60;

const caseFields = ["failures", "failuresNotListed", "notLoaded"];

let copiesMade = 0;

export async function called(context: ScriptContext, reference: string, input: Json): Promise<Called> {
  const answer = await context.call(reference, input);
  return answer.ok ? { ok: true, value: answer.value } : { ok: false, reason: "The call to " + reference + " failed: " + answer.message };
}

export function textOf(value: Json, name: string): string {
  const field = fieldsOf(value)[name];
  return typeof field === "string" ? field : "";
}

export function linksOf(context: ScriptContext): readonly string[] {
  const links = context.settings.links;
  return Array.isArray(links) ? links.filter((link) => typeof link === "string") : [];
}

export async function inCopy<Result>(context: ScriptContext, commit: string, use: (copy: Copy) => Promise<Result>): Promise<Result> {
  copiesMade += 1;
  const name = "proof-" + String(context.now().getTime()) + "-" + String(copiesMade);
  const copy = await called(context, "worktrees.copy", { commit, name, links: linksOf(context) });
  if (!copy.ok) {
    return use({ made: false, reason: "No copy of " + commit + " could be made. " + copy.reason });
  }
  const folder = textOf(copy.value, "folder");
  try {
    return await use({ made: true, folder });
  } finally {
    await called(context, "worktrees.remove", { folder });
  }
}

export async function testRun(context: ScriptContext, folder: string, files?: readonly string[]): Promise<TestRun> {
  const run = await called(context, "toolchain.test", files === undefined ? { folder } : { folder, files });
  if (!run.ok) {
    return { verdict: "inconclusive", reason: run.reason };
  }
  const fields = fieldsOf(run.value);
  if (fields.verdict === "passed") {
    return { verdict: "passed", passed: typeof fields.passed === "number" ? fields.passed : 0 };
  }
  if (fields.verdict === "failed") {
    const given = caseFields.flatMap((name): [string, Json][] => {
      const value = fields[name];
      return value === undefined ? [] : [[name, value]];
    });
    return { verdict: "failed", failed: typeof fields.failed === "number" ? fields.failed : 0, cases: Object.fromEntries(given) };
  }
  return { verdict: "inconclusive", reason: "The test run is not known. " + textOf(run.value, "reason") };
}

export function onlyFilesThatDidNotLoad(cases: Cases): boolean {
  const listed = Array.isArray(cases.failures) ? cases.failures.length : 0;
  const notListed = typeof cases.failuresNotListed === "number" ? cases.failuresNotListed : 0;
  return Array.isArray(cases.notLoaded) && cases.notLoaded.length > 0 && listed + notListed === 0;
}

export type Runnable =
  | { readonly through: "bay"; readonly words: readonly string[] }
  | { readonly through: "toolchain"; readonly name: string; readonly arguments: readonly string[] };

function toolchainEnded(value: Json, name: string): Ended {
  const fields = fieldsOf(value);
  const { exitCode, stdout, stdoutCut } = fields;
  if (fields.ended === "exited" && typeof exitCode === "number" && typeof stdout === "string" && stdoutCut === false) {
    return { how: "exited", exitCode, stdout };
  }
  if (fields.ended === "exited") {
    return { how: "unknown", reason: "The command " + name + " printed more than proof reads." };
  }
  return { how: "unknown", reason: "The command " + name + " did not end with an exit code. " + textOf(value, "reason") };
}

export async function commandIn(context: ScriptContext, folder: string, command: Runnable): Promise<Ended> {
  if (command.through === "bay") {
    return ranIn(context, folder, { name: "bay", arguments: command.words });
  }
  const asked = { folder, name: command.name, arguments: command.arguments, timeLimitSeconds: commandSeconds };
  const answer = await called(context, "toolchain.run", asked);
  return answer.ok ? toolchainEnded(answer.value, command.name) : { how: "unknown", reason: answer.reason };
}

export async function ranIn(context: ScriptContext, folder: string, command: { readonly name: string; readonly arguments: readonly string[] }): Promise<Ended> {
  const answer = await context.commands.run({ ...command, folder, timeLimitSeconds: commandSeconds });
  if (!answer.ok) {
    return { how: "unknown", reason: "The command " + command.name + " could not be started: " + answer.message };
  }
  const { end, stdout } = answer.value;
  switch (end.how) {
    case "exited":
      return { how: "exited", exitCode: end.exitCode, stdout: stdout.text };
    case "timed-out":
      return { how: "unknown", reason: "The command " + command.name + " did not finish within " + String(commandSeconds) + " seconds." };
    case "signalled":
      return { how: "unknown", reason: "The command " + command.name + " was stopped by the signal " + end.signal + "." };
  }
}
`;

const changesLibrary = String.raw`import { pathMatch, type ScriptContext } from "${sdkFromLibrary}";
import { called, ranIn, type Copy } from "./calls.ts";
import type { Request } from "./request.ts";
import { broken, counted, decided, held, unknown, type Part, type Verdict } from "./verdicts.ts";

export type ChangedPath =
  | { readonly how: "added" | "modified" | "deleted"; readonly path: string }
  | { readonly how: "renamed"; readonly path: string; readonly from: string };

export type Changed = { readonly known: true; readonly paths: readonly ChangedPath[] } | { readonly known: false; readonly reason: string };

type Size = { readonly path: string; readonly base?: number; readonly head?: number };

type Copies = { readonly base: Copy; readonly head: Copy };

type ActionNames = { readonly gained: readonly string[]; readonly lost: readonly string[]; readonly changed: readonly string[] };

function changedPathOf(value: unknown): ChangedPath {
  const field = (name: string): string => {
    const found: unknown = typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
    return typeof found === "string" ? found : "";
  };
  const how = field("how");
  if (how === "renamed") {
    return { how, path: field("path"), from: field("from") };
  }
  return { how: how === "added" || how === "deleted" ? how : "modified", path: field("path") };
}

export async function changedBetween(context: ScriptContext, request: Request): Promise<Changed> {
  const answer = await called(context, "worktrees.changed", { from: request.base, to: request.head });
  if (!answer.ok) {
    return { known: false, reason: "What changed between the base and the head is not known. " + answer.reason };
  }
  const paths: unknown = typeof answer.value === "object" && answer.value !== null ? Reflect.get(answer.value, "paths") : [];
  return { known: true, paths: Array.isArray(paths) ? paths.map(changedPathOf) : [] };
}

function touchedPaths(paths: readonly ChangedPath[]): readonly string[] {
  return paths.flatMap((changed) => (changed.how === "renamed" ? [changed.from, changed.path] : [changed.path]));
}

export function inScope(request: Request, changed: Changed): Verdict {
  if (!changed.known) {
    return decided("scope", "in-scope", [unknown(changed.reason)], "");
  }
  const touched = touchedPaths(changed.paths);
  const outside = touched.filter((path) => !request.scope.some((pattern) => pathMatch(pattern, path).kind === "matched"));
  const parts = outside.length === 0 ? [held] : [broken(counted(outside.length, "changed path is", "changed paths are") + " outside the scope: " + outside.join(", ") + ".")];
  const count = String(touched.length);
  return decided("scope", "in-scope", parts, "Every changed path is in the scope: " + count + " of " + count + ".");
}

function isActionList(path: string): boolean {
  return path === "mode.yaml" || path.endsWith("/mode.yaml") || /^components\/base\/interfaces\/[^/]+\.yaml$/.test(path);
}

function actionsOf(text: string): ReadonlyMap<string, string> {
  const name = /^name: (.+)$/m.exec(text)?.[1] ?? "";
  const lines = text.split("\n");
  const actions = new Map<string, string>();
  let current: string | undefined;
  for (const line of lines.slice(lines.indexOf("actions:") + 1)) {
    if (!line.startsWith(" ")) {
      break;
    }
    const action = /^  ([a-z][a-z0-9-]*):/.exec(line)?.[1];
    current = action === undefined ? current : name + "." + action;
    if (current !== undefined) {
      actions.set(current, (actions.get(current) ?? "") + line + "\n");
    }
  }
  return lines.includes("actions:") ? actions : new Map();
}

async function printed(context: ScriptContext, copy: Copy, path: string | undefined): Promise<string | undefined> {
  if (path === undefined || !copy.made) {
    return "";
  }
  const ended = await ranIn(context, copy.folder, { name: "print", arguments: [path] });
  return ended.how === "exited" && ended.exitCode === 0 ? ended.stdout : undefined;
}

async function actionNames(context: ScriptContext, paths: readonly ChangedPath[], copies: Copies): Promise<ActionNames | undefined> {
  const names = { gained: new Set<string>(), lost: new Set<string>(), changed: new Set<string>() };
  for (const changed of paths.filter((entry) => isActionList(entry.path))) {
    const before = await printed(context, copies.base, changed.how === "added" ? undefined : changed.how === "renamed" ? changed.from : changed.path);
    const after = await printed(context, copies.head, changed.how === "deleted" ? undefined : changed.path);
    if (before === undefined || after === undefined || !copies.base.made || !copies.head.made) {
      return undefined;
    }
    const was = actionsOf(before);
    const is = actionsOf(after);
    for (const [action, block] of is) {
      if (!was.has(action)) {
        names.gained.add(action);
      } else if (was.get(action) !== block) {
        names.changed.add(action);
      }
    }
    for (const action of was.keys()) {
      if (!is.has(action)) {
        names.lost.add(action);
      }
    }
  }
  return { gained: [...names.gained], lost: [...names.lost], changed: [...names.changed] };
}

function missingFrom(wanted: readonly string[], given: readonly string[]): number {
  return wanted.filter((entry) => !given.includes(entry)).length;
}

function namesMissingFrom(wanted: ActionNames, given: ActionNames): number {
  return missingFrom(wanted.gained, given.gained) + missingFrom(wanted.lost, given.lost) + missingFrom(wanted.changed, given.changed);
}

export async function asDeclared(context: ScriptContext, request: Request, changed: Changed, copies: Copies): Promise<Verdict> {
  if (!changed.known) {
    return decided("declared", "as-declared", [unknown(changed.reason)], "");
  }
  const names = await actionNames(context, changed.paths, copies);
  if (names === undefined) {
    return decided("declared", "as-declared", [unknown("The action names at the base or the head could not be read.")], "");
  }
  const touched = touchedPaths(changed.paths);
  const parts: Part[] = [];
  const undeclared = missingFrom(touched, request.files);
  const unchanged = missingFrom(request.files, touched);
  if (undeclared > 0) {
    parts.push(broken(counted(undeclared, "changed file was", "changed files were") + " not declared."));
  }
  if (unchanged > 0) {
    parts.push(broken(counted(unchanged, "declared file did", "declared files did") + " not change."));
  }
  const namesUndeclared = namesMissingFrom(names, request.names);
  const namesUnchanged = namesMissingFrom(request.names, names);
  if (namesUndeclared > 0) {
    parts.push(broken(counted(namesUndeclared, "action name changed and was", "action names changed and were") + " not declared."));
  }
  if (namesUnchanged > 0) {
    parts.push(broken(counted(namesUnchanged, "declared action name did", "declared action names did") + " not change as declared."));
  }
  const nameCount = names.gained.length + names.lost.length + names.changed.length;
  const summary = "What changed is as declared: " + counted(touched.length, "file", "files") + " and " + counted(nameCount, "action name", "action names") + ".";
  return decided("declared", "as-declared", parts.length === 0 ? [held] : parts, summary);
}

async function linesIn(context: ScriptContext, copy: Copy, path: string): Promise<number | undefined> {
  if (!copy.made) {
    return undefined;
  }
  const ended = await ranIn(context, copy.folder, { name: "count-lines", arguments: [path] });
  return ended.how === "exited" && ended.exitCode === 0 ? Number.parseInt(ended.stdout.trim(), 10) : undefined;
}

export async function sizes(context: ScriptContext, changed: Changed, copies: Copies): Promise<readonly Size[]> {
  if (!changed.known) {
    return [];
  }
  const found: Size[] = [];
  for (const entry of changed.paths) {
    const basePath = entry.how === "added" ? undefined : entry.how === "renamed" ? entry.from : entry.path;
    const base = basePath === undefined ? undefined : await linesIn(context, copies.base, basePath);
    const head = entry.how === "deleted" ? undefined : await linesIn(context, copies.head, entry.path);
    found.push({ path: entry.path, ...(base === undefined ? {} : { base }), ...(head === undefined ? {} : { head }) });
  }
  return found;
}
`;

const readingKinds = String.raw`import type { ScriptContext } from "${sdkFromLibrary}";
import { commandIn, ranIn, type Copy, type Ended } from "./calls.ts";
import type { Command, Count, DeclaredCommand, Request } from "./request.ts";
import { broken, decided, held, unknown, type Part, type Verdict } from "./verdicts.ts";

type Copies = { readonly base: Copy; readonly head: Copy };

type Lines = { readonly known: true; readonly lines: number } | { readonly known: false; readonly reason: string };

export const noCommandsSentence = "This project declares no commands whose output must not change, so nothing is known.";

async function runIn(context: ScriptContext, copy: Copy, command: Command): Promise<Ended> {
  return copy.made ? commandIn(context, copy.folder, command) : { how: "unknown", reason: copy.reason };
}

function sameEnd(base: Ended, head: Ended): boolean {
  return base.how === "exited" && head.how === "exited" && base.exitCode === head.exitCode && base.stdout === head.stdout;
}

async function commandPart(context: ScriptContext, command: DeclaredCommand, copies: Copies, differs: boolean): Promise<Part> {
  const base = await runIn(context, copies.base, command.command);
  const head = await runIn(context, copies.head, command.command);
  for (const end of [base, head]) {
    if (end.how === "unknown") {
      return unknown("The output of " + command.name + " is not known. " + end.reason);
    }
  }
  const same = sameEnd(base, head);
  if (same && differs) {
    return broken(command.name + " printed the same at the head, though the item says it differs.");
  }
  return same || differs ? held : broken(command.name + " printed otherwise at the head.");
}

export async function sameOutput(context: ScriptContext, request: Request, item: { readonly id: string; readonly differ: readonly string[] }, copies: Copies): Promise<Verdict> {
  const commands = request.sameOutput;
  if (commands.length === 0) {
    return decided(item.id, "same-output", [unknown(noCommandsSentence)], "");
  }
  const strangers = item.differ.filter((name) => !commands.some((command) => command.name === name));
  if (strangers.length > 0) {
    return decided(item.id, "same-output", [unknown("The item names " + strangers.join(", ") + ", which the project does not declare.")], "");
  }
  const parts: Part[] = [];
  for (const command of commands) {
    parts.push(await commandPart(context, command, copies, item.differ.includes(command.name)));
  }
  const count = String(commands.length);
  return decided(item.id, "same-output", parts, "Every declared command printed as the item says: " + count + " of " + count + ".");
}

async function linesHolding(context: ScriptContext, copy: Copy, counted: { readonly pattern: string; readonly paths: readonly string[] }): Promise<Lines> {
  if (!copy.made) {
    return { known: false, reason: copy.reason };
  }
  const ended = await ranIn(context, copy.folder, { name: "count-matches", arguments: [counted.pattern, "--", ...counted.paths] });
  if (ended.how === "unknown") {
    return { known: false, reason: ended.reason };
  }
  if (ended.exitCode !== 0 && ended.exitCode !== 1) {
    return { known: false, reason: "The lines could not be counted in " + counted.paths.join(", ") + "." };
  }
  const counts = ended.stdout.split("\n").filter((line) => line !== "").map((line) => Number.parseInt(line.slice(line.lastIndexOf(":") + 1), 10));
  return { known: true, lines: counts.reduce((total, count) => total + count, 0) };
}

function resolved(request: Request, count: Count): Exclude<Count, { readonly of: "declared" }> | undefined {
  if (count.of !== "declared") {
    return count;
  }
  const declared = request.noRise.find((entry) => entry.name === count.name);
  return declared === undefined ? undefined : { of: "no rise", pattern: declared.pattern, paths: declared.paths };
}

export async function countVerdict(context: ScriptContext, request: Request, item: { readonly id: string; readonly count: Count }, copies: Copies): Promise<Verdict> {
  const count = resolved(request, item.count);
  if (count === undefined) {
    return decided(item.id, "count", [unknown("The project declares no count of that name.")], "");
  }
  const head = await linesHolding(context, copies.head, count);
  if (!head.known) {
    return decided(item.id, "count", [unknown(head.reason)], "");
  }
  if (count.of === "most") {
    const said = String(head.lines) + " lines hold the text, and at most " + String(count.most) + " may.";
    return decided(item.id, "count", [head.lines <= count.most ? held : broken(said)], said);
  }
  const base = await linesHolding(context, copies.base, count);
  if (!base.known) {
    return decided(item.id, "count", [unknown(base.reason)], "");
  }
  const said = String(head.lines) + " lines hold the text at the head, and " + String(base.lines) + " at the base.";
  return decided(item.id, "count", [head.lines <= base.lines ? held : broken(said)], said);
}
`;

const baseRunFunction = String.raw`async function baseRun(context: ScriptContext, request: Request, tests: readonly string[]): Promise<Part> {
  return inCopy(context, request.base, async (copy) => {
    if (!copy.made) {
      return unknown(copy.reason);
    }
    const laid = await called(context, "worktrees.overlay", { folder: copy.folder, commit: request.head, paths: tests });
    if (!laid.ok) {
      return unknown(laid.reason);
    }
    const run = await testRun(context, copy.folder, tests);
    if (run.verdict === "inconclusive") {
      return unknown("On the base: " + run.reason);
    }
    return run.verdict === "failed" ? held : broken("The named tests already pass on the base, so they do not show the change.");
  });
}
`;

const codeKinds = String.raw`import type { ScriptContext } from "${sdkFromLibrary}";
import { called, commandIn, inCopy, onlyFilesThatDidNotLoad, testRun, type Copy } from "./calls.ts";
import type { Bug, Request, Run } from "./request.ts";
import { broken, brokenShowing, counted, decided, held, unknown, type Part, type Verdict } from "./verdicts.ts";

function partOfCheck(name: string, verdict: string, reason: string): Part {
  if (verdict === "passed") {
    return held;
  }
  return verdict === "failed" ? broken("The check " + name + " found a fault.") : unknown("The check " + name + " is not known: " + reason);
}

async function checkParts(context: ScriptContext, copy: Copy): Promise<readonly Part[]> {
  if (!copy.made) {
    return [unknown(copy.reason)];
  }
  const checked = await called(context, "toolchain.check", { folder: copy.folder });
  if (!checked.ok) {
    return [unknown(checked.reason)];
  }
  const listed: unknown = typeof checked.value === "object" && checked.value !== null ? Reflect.get(checked.value, "verdicts") : [];
  const parts = (Array.isArray(listed) ? listed : []).map((entry: unknown) => {
    const field = (name: string): string => {
      const value: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, name) : undefined;
      return typeof value === "string" ? value : "";
    };
    return partOfCheck(field("name"), field("verdict"), field("reason"));
  });
  const tests = await testRun(context, copy.folder);
  const testPart = tests.verdict === "passed" ? held : tests.verdict === "failed" ? brokenShowing(counted(tests.failed, "test failed.", "tests failed."), tests.cases) : unknown(tests.reason);
  return [...parts, testPart];
}

export async function checks(context: ScriptContext, id: string, head: Copy): Promise<Verdict> {
  const parts = await checkParts(context, head);
  return decided(id, "checks", parts, "Every check passed, and so did the test run.");
}

${baseRunFunction}
async function headRun(context: ScriptContext, head: Copy, tests: readonly string[]): Promise<Part> {
  if (!head.made) {
    return unknown(head.reason);
  }
  const run = await testRun(context, head.folder, tests);
  if (run.verdict === "inconclusive") {
    return unknown("On the head: " + run.reason);
  }
  return run.verdict === "passed" ? held : brokenShowing("The named tests fail on the head.", run.cases);
}

export async function failsFirst(context: ScriptContext, request: Request, item: { readonly id: string; readonly tests: readonly string[] }, head: Copy): Promise<Verdict> {
  const parts = [await baseRun(context, request, item.tests), await headRun(context, head, item.tests)];
  return decided(item.id, "fails-first", parts, "The named tests failed on the base and pass on the head.");
}

async function bugPart(context: ScriptContext, request: Request, bug: Bug): Promise<Part> {
  return inCopy(context, request.head, async (copy) => {
    if (!copy.made) {
      return unknown(copy.reason);
    }
    const applied = await called(context, "worktrees.apply", { folder: copy.folder, patch: bug.patch });
    if (!applied.ok) {
      return unknown("The bug " + bug.name + " could not be applied. " + applied.reason);
    }
    const run = await testRun(context, copy.folder, bug.tests);
    if (run.verdict === "inconclusive") {
      return unknown("The run with the bug " + bug.name + " is not known. " + run.reason);
    }
    if (run.verdict === "failed" && onlyFilesThatDidNotLoad(run.cases)) {
      return unknown("The tests of the bug " + bug.name + " did not run: no case failed, and a test file did not load.");
    }
    return run.verdict === "failed" ? held : broken("A bug survived: " + bug.name + ".");
  });
}

export async function bugsCaught(context: ScriptContext, request: Request, id: string): Promise<Verdict> {
  if (request.bugs.length === 0) {
    return decided(id, "bugs-caught", [unknown("No bugs were given to inject, so nothing is known.")], "");
  }
  const parts: Part[] = [];
  for (const bug of request.bugs) {
    parts.push(await bugPart(context, request, bug));
  }
  const count = String(request.bugs.length);
  const summary = "Every injected bug was caught: " + count + " of " + count + ".";
  return decided(id, "bugs-caught", parts, summary);
}

async function runPart(context: ScriptContext, folder: string, run: Run, place: string): Promise<Part> {
  const ended = await commandIn(context, folder, run.command);
  if (ended.how === "unknown") {
    return unknown(place + " did not end with an exit code. " + ended.reason);
  }
  if (ended.stdout !== run.stdout) {
    return broken(place + " printed other than the item expects.");
  }
  return ended.exitCode === run.exitCode ? held : broken(place + " ended with the exit code " + String(ended.exitCode) + ".");
}

export async function realThing(context: ScriptContext, request: Request, item: { readonly id: string; readonly runs: readonly Run[] }): Promise<Verdict> {
  const parts = await inCopy(context, request.head, async (copy) => {
    if (!copy.made) {
      return [unknown(copy.reason)];
    }
    const found: Part[] = [];
    for (const [index, run] of item.runs.entries()) {
      found.push(await runPart(context, copy.folder, run, "Run " + String(index + 1) + " of " + String(item.runs.length)));
    }
    return found;
  });
  return decided(item.id, "real-thing", parts, "Every run printed the expected text and exit code.");
}
`;

const proveScript = String.raw`import { defineScript, type ScriptContext } from "${sdkFromScripts}";
import { inCopy, type Copy } from "./lib/calls.ts";
import { asDeclared, changedBetween, inScope, sizes } from "./lib/changes.ts";
import { bugsCaught, checks, failsFirst, realThing } from "./lib/code-kinds.ts";
import { countVerdict, sameOutput } from "./lib/reading-kinds.ts";
import { requestOf, type ProvenItem, type Request } from "./lib/request.ts";
import type { Verdict } from "./lib/verdicts.ts";

type Copies = { readonly base: Copy; readonly head: Copy };

function verdictOf(context: ScriptContext, request: Request, item: ProvenItem, copies: Copies): Promise<Verdict> {
  const { id, proof } = item;
  switch (proof.kind) {
    case "checks":
      return checks(context, id, copies.head);
    case "fails-first":
      return failsFirst(context, request, { id, tests: proof.tests }, copies.head);
    case "bugs-caught":
      return bugsCaught(context, request, id);
    case "same-output":
      return sameOutput(context, request, { id, differ: proof.differ }, copies);
    case "count":
      return countVerdict(context, request, { id, count: proof.count }, copies);
    case "real-thing":
      return realThing(context, request, { id, runs: proof.runs });
  }
}

export const run = defineScript(async (input, context) => {
  const request = requestOf(input, context.settings);
  const changed = await changedBetween(context, request);
  return inCopy(context, request.base, (base) =>
    inCopy(context, request.head, async (head) => {
      const copies = { base, head };
      const own: Verdict[] = [];
      for (const item of request.proven) {
        own.push(await verdictOf(context, request, item, copies));
      }
      const added = [inScope(request, changed), await asDeclared(context, request, changed, copies)];
      return { verdicts: [...own, ...added], judgement: request.judgement, size: await sizes(context, changed, copies) };
    }),
  );
});
`;

const exampleInput = {
  slice: {
    name: "ONE",
    kind: "mode",
    scope: ["src/**"],
    after: [],
    done: [
      { id: "DOD-ONE-1", says: "The checks and the tests pass.", level: "must", proof: { kind: "checks" } },
      { id: "DOD-ONE-2", says: "The words tell the owner what to do.", level: "should" },
    ],
  },
  base: "main",
  head: "forge/one",
  declared: { files: ["src/one.txt"], names: { gained: [], lost: [], changed: [] } },
  bugs: [],
};

const exampleOutput = {
  verdicts: [
    { item: "DOD-ONE-1", kind: "checks", verdict: "passed", detail: "Every check passed, and so did the test run." },
    { item: "scope", kind: "in-scope", verdict: "passed", detail: "Every changed path is in the scope: 1 of 1." },
    {
      item: "declared",
      kind: "as-declared",
      verdict: "passed",
      detail: "What changed is as declared: 1 file and 0 action names.",
    },
  ],
  judgement: [{ id: "DOD-ONE-2", says: "The words tell the owner what to do.", level: "should" }],
  size: [{ path: "src/one.txt", base: 1, head: 2 }],
};

function modeTest(name: string): string {
  return lines(
    'import { testProof } from "../../interfaces/proof/tests/shared.ts";',
    "",
    `testProof({ mode: "${name}" });`,
  );
}

const leavesACopyBaseRun = String.raw`async function baseRun(context: ScriptContext, request: Request, tests: readonly string[]): Promise<Part> {
  const name = "proof-base-" + String(context.now().getTime());
  const copy = await called(context, "worktrees.copy", { commit: request.base, name, links: linksOf(context) });
  if (!copy.ok) {
    return unknown(copy.reason);
  }
  const folder = textOf(copy.value, "folder");
  const laid = await called(context, "worktrees.overlay", { folder, commit: request.head, paths: tests });
  if (!laid.ok) {
    return unknown(laid.reason);
  }
  const run = await testRun(context, folder, tests);
  if (run.verdict === "inconclusive") {
    return unknown("On the base: " + run.reason);
  }
  await called(context, "worktrees.remove", { folder });
  return run.verdict === "failed" ? held : broken("The named tests already pass on the base, so they do not show the change.");
}
`;

const worktreeChecks = String.raw`  const cut = await called(context, "worktrees.cut", { slice: "proof-checks-" + String(context.now().getTime()), base: commit });
  if (!cut.ok) {
    return decided(id, "checks", [unknown(cut.reason)], "");
  }
  const folder = textOf(cut.value, "folder");
  const parts = await checkParts(context, { made: true, folder });
  await called(context, "worktrees.remove", { folder, into: commit });`;

const codeKindsImport =
  'import { called, commandIn, inCopy, onlyFilesThatDidNotLoad, testRun, type Copy } from "./calls.ts";';

const codeKindsImportWithText =
  'import { called, commandIn, inCopy, linksOf, onlyFilesThatDidNotLoad, testRun, textOf, type Copy } from "./calls.ts";';

const replacements: Readonly<Record<ProofVariant, readonly Replacement[]>> = {
  "proves by the interface": [],
  "reports passed for an inconclusive check": [
    [
      "scripts/lib/code-kinds.ts",
      '  return verdict === "failed" ? broken("The check " + name + " found a fault.") : unknown("The check " + name + " is not known: " + reason);',
      '  return verdict === "failed" ? broken("The check " + name + " found a fault.") : held;',
    ],
  ],
  "gives the toolchain a worktree": [
    ["scripts/lib/code-kinds.ts", codeKindsImport, codeKindsImportWithText],
    [
      "scripts/lib/code-kinds.ts",
      "export async function checks(context: ScriptContext, id: string, head: Copy): Promise<Verdict> {",
      "export async function checks(context: ScriptContext, id: string, head: Copy, commit: string): Promise<Verdict> {",
    ],
    [
      "scripts/prove.ts",
      "      return checks(context, id, copies.head);",
      "      return checks(context, id, copies.head, request.head);",
    ],
    ["scripts/lib/code-kinds.ts", "  const parts = await checkParts(context, head);", worktreeChecks],
  ],
  "leaves a copy behind when the toolchain fails": [
    ["scripts/lib/code-kinds.ts", codeKindsImport, codeKindsImportWithText],
    ["scripts/lib/code-kinds.ts", baseRunFunction, leavesACopyBaseRun],
  ],
  "passes a bug that survives": [
    [
      "scripts/lib/code-kinds.ts",
      '    return run.verdict === "failed" ? held : broken("A bug survived: " + bug.name + ".");',
      "    return held;",
    ],
  ],
  "puts a declared path into a detail": [
    [
      "scripts/lib/changes.ts",
      '    parts.push(broken(counted(unchanged, "declared file did", "declared files did") + " not change."));',
      '    parts.push(broken(counted(unchanged, "declared file did", "declared files did") + " not change: " + request.files.filter((file) => !touched.includes(file)).join(", ") + "."));',
    ],
  ],
  "counts a bug that could not be applied as caught": [
    [
      "scripts/lib/code-kinds.ts",
      '      return unknown("The bug " + bug.name + " could not be applied. " + applied.reason);',
      "      return held;",
    ],
  ],
  "counts a bug whose tests did not load as caught": [
    [
      "scripts/lib/code-kinds.ts",
      '      return unknown("The tests of the bug " + bug.name + " did not run: no case failed, and a test file did not load.");',
      "      return held;",
    ],
  ],
  "reads a cut output of a command as whole": [
    [
      "scripts/lib/calls.ts",
      '  if (fields.ended === "exited" && typeof exitCode === "number" && typeof stdout === "string" && stdoutCut === false) {',
      '  if (fields.ended === "exited" && typeof exitCode === "number" && typeof stdout === "string") {',
    ],
  ],
  "omits the two added items when every item is judgement": [
    [
      "scripts/prove.ts",
      "  const changed = await changedBetween(context, request);",
      [
        "  if (request.proven.length === 0) {",
        "    return { verdicts: [], judgement: request.judgement, size: [] };",
        "  }",
        "  const changed = await changedBetween(context, request);",
      ].join("\n"),
    ],
  ],
};

function replaced(files: ModeFiles, replacement: Replacement): ModeFiles {
  const [file, line, wrong] = replacement;
  const text = files[file] ?? "";
  if (!text.includes(line)) {
    throw new Error(`The made-up proof's ${file} does not hold the line a wrong proof replaces: ${line}`);
  }
  return { ...files, [file]: text.replace(line, wrong) };
}

export const assay = "assay";

export const wrongProofs: Readonly<Record<string, ProofVariant>> = {
  "assay-passes-unknown": "reports passed for an inconclusive check",
  "assay-worktree": "gives the toolchain a worktree",
  "assay-leaves-copy": "leaves a copy behind when the toolchain fails",
  "assay-passes-survivor": "passes a bug that survives",
  "assay-shows-declared": "puts a declared path into a detail",
  "assay-omits-added": "omits the two added items when every item is judgement",
  "assay-passes-stale-bug": "counts a bug that could not be applied as caught",
  "assay-passes-unloaded-bug": "counts a bug whose tests did not load as caught",
  "assay-reads-cut-output": "reads a cut output of a command as whole",
};

export function proofFiles(name: string, variant: ProofVariant): ModeFiles {
  const correct: ModeFiles = {
    "mode.yaml": manifestOf(name),
    "README.md": lines(
      `# ${name}`,
      "",
      "Proves a slice's items by script, through a toolchain and a worktrees mode. A test adds it to a copy of the kit.",
    ),
    "schemas/settings.json": settingsSchema,
    "scripts/prove.ts": proveScript,
    "scripts/lib/request.ts": requestLibrary,
    "scripts/lib/verdicts.ts": verdictsLibrary,
    "scripts/lib/calls.ts": callsLibrary,
    "scripts/lib/changes.ts": changesLibrary,
    "scripts/lib/reading-kinds.ts": readingKinds,
    "scripts/lib/code-kinds.ts": codeKinds,
    "tests/prove.example.json": `${JSON.stringify({ input: exampleInput, output: exampleOutput }, null, 2)}\n`,
    [`tests/${name}.test.ts`]: modeTest(name),
  };
  return replacements[variant].reduce(replaced, correct);
}
