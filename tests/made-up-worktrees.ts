import type { ModeFiles } from "./kit-copy.ts";

export type ShelfVariant = "keeps a changed worktree" | "removes a changed worktree";

export const shelf = "shelf";

export const wrongShelf = "shelf-wrong";

const examples: readonly string[] = [
  "cut",
  "status",
  "changed",
  "copy",
  "overlay",
  "remove",
  "merge",
  "set-aside",
  "apply",
];

const exampleTexts: Readonly<Record<string, string>> = {
  cut: String.raw`{
  "input": { "slice": "mail-source", "base": "main" },
  "output": {
    "folder": ".forge/worktrees/mail-source",
    "branch": "forge/mail-source",
    "commit": "79fe81d1c4a6b0e2f3d5a7c9e1b3d5f7a9c1e3b5"
  }
}
`,
  status: String.raw`{
  "input": { "folder": ".forge/worktrees/mail-source", "base": "main" },
  "output": {
    "head": "5b1f3c2d4e6a8b0c1d3e5f7a9b1c3d5e7f9a1b3c",
    "commits": [{ "hash": "5b1f3c2d4e6a8b0c1d3e5f7a9b1c3d5e7f9a1b3c", "subject": "Add the mail source mode" }],
    "clean": false,
    "changed": ["components/modes/mail-source/mode.yaml"],
    "untracked": ["components/modes/mail-source/tests/read.test.ts"]
  }
}
`,
  changed: String.raw`{
  "input": { "from": "main", "to": "forge/mail-source" },
  "output": {
    "paths": [
      { "path": "components/modes/mail-source/mode.yaml", "how": "added" },
      { "path": "framework/features.yaml", "how": "modified" },
      { "path": "docs/old-notes.md", "how": "deleted" },
      { "path": "docs/mail.md", "how": "renamed", "from": "docs/mail-notes.md" }
    ]
  }
}
`,
  copy: String.raw`{
  "input": { "commit": "forge/mail-source", "name": "mail-source-check", "links": ["node_modules"] },
  "output": { "folder": ".forge/copies/mail-source-check" }
}
`,
  overlay: String.raw`{
  "input": { "folder": ".forge/copies/mail-source-check", "commit": "main", "paths": ["bay/sdk.ts", "docs/draft.md"] },
  "output": { "folder": ".forge/copies/mail-source-check", "placed": ["bay/sdk.ts"], "removed": ["docs/draft.md"] }
}
`,
  remove: String.raw`{
  "input": { "folder": ".forge/worktrees/mail-source", "into": "main" },
  "output": { "folder": ".forge/worktrees/mail-source", "kind": "worktree", "branch": "forge/mail-source" }
}
`,
  merge: String.raw`{
  "input": { "folder": ".forge/worktrees/mail-source", "into": "integration" },
  "output": {
    "how": "merged",
    "branch": "forge/mail-source",
    "into": "integration",
    "commit": "3c5e7a9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c"
  }
}
`,
  "set-aside": String.raw`{
  "input": { "folder": ".forge/worktrees/mail-source" },
  "output": {
    "how": "set-aside",
    "folder": ".forge/worktrees/mail-source",
    "branch": "forge/wip/mail-source/1",
    "commit": "9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c"
  }
}
`,
  apply: String.raw`{
  "input": {
    "folder": ".forge/copies/mail-source-check",
    "patch": "diff --git a/bay/sdk.ts b/bay/sdk.ts\n--- a/bay/sdk.ts\n+++ b/bay/sdk.ts\n@@ -1 +1 @@\n-export const answer = 41;\n+export const answer = 42;\n"
  },
  "output": {
    "folder": ".forge/copies/mail-source-check",
    "paths": ["bay/sdk.ts"]
  }
}
`,
};

const migration = String.raw`create table folders (
  folder text primary key,
  kind text not null check (kind in ('worktree', 'copy'))
);
`;

const library = String.raw`import { fail, fieldsOf, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";

export type Files = Readonly<Record<string, string>>;

export type Commit = {
  readonly parents: readonly string[];
  readonly subject: string;
  readonly files: Files;
};

export type Kind = "worktree" | "copy";

export type WorktreeState = {
  readonly head: string;
  readonly changed: readonly string[];
  readonly untracked: readonly string[];
};

type Answered<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly message: string };

type Ended = { readonly exitCode: number; readonly stdout: string; readonly stderr: string };

export const marker = ".shelf";

const alwaysIgnored: readonly string[] = [".agentbay", ".forge", ".shelf"];

const branchesFile = ".shelf/branches.json";

const timeLimitSeconds = 60;

export async function answered<Value>(answer: Promise<Answered<Value>>): Promise<Value> {
  const given = await answer;
  return given.ok ? given.value : fail(given.message);
}

export function textField(input: Json, name: string): string {
  const value = fieldsOf(input)[name];
  return typeof value === "string" ? value : fail("The request has no " + name + ".");
}

export function textsField(input: Json, name: string): readonly string[] {
  const value = fieldsOf(input)[name];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

async function readText(context: ScriptContext, path: string): Promise<string | undefined> {
  const answer = await context.files.read(path);
  return answer.ok ? answer.value : undefined;
}

function textsOf(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function branches(context: ScriptContext): Promise<Readonly<Record<string, string>>> {
  const text = await readText(context, branchesFile);
  const parsed: unknown = text === undefined ? {} : JSON.parse(text);
  return textsOf(parsed);
}

export async function writeBranches(context: ScriptContext, all: Readonly<Record<string, string>>): Promise<void> {
  await answered(context.files.write(branchesFile, JSON.stringify(all, null, 2) + "\n"));
}

export async function commitOf(context: ScriptContext, name: string): Promise<string> {
  const named = (await branches(context))[name];
  if (named !== undefined) {
    return named;
  }
  if (/^[0-9a-f]{4,40}$/.test(name)) {
    const listed = await answered(context.files.list(".shelf/commits"));
    const found = listed.map((file) => file.replace(/\.json$/, "")).filter((hash) => hash.startsWith(name));
    if (found.length === 1 && found[0] !== undefined) {
      return found[0];
    }
  }
  return fail("There is no commit " + name + " on the shelf.");
}

export async function readCommit(context: ScriptContext, hash: string): Promise<Commit> {
  const text = await readText(context, ".shelf/commits/" + hash + ".json");
  if (text === undefined) {
    return fail("There is no commit " + hash + " on the shelf.");
  }
  const parsed: unknown = JSON.parse(text);
  const fields = typeof parsed === "object" && parsed !== null ? parsed : {};
  const parents = Reflect.get(fields, "parents");
  const subject = Reflect.get(fields, "subject");
  return {
    parents: Array.isArray(parents) ? parents.filter((parent) => typeof parent === "string") : [],
    subject: typeof subject === "string" ? subject : "",
    files: textsOf(Reflect.get(fields, "files")),
  };
}

export async function ancestors(context: ScriptContext, hash: string): Promise<ReadonlySet<string>> {
  const seen = new Set<string>();
  const waiting = [hash];
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    if (!seen.has(next)) {
      seen.add(next);
      waiting.push(...(await readCommit(context, next)).parents);
    }
  }
  return seen;
}

export async function ignoredPaths(context: ScriptContext): Promise<readonly string[]> {
  const text = (await readText(context, ".shelf/ignored")) ?? "";
  return [...alwaysIgnored, ...text.split("\n").filter((line) => line !== "")];
}

export function isIgnored(path: string, ignored: readonly string[]): boolean {
  return ignored.some((entry) => path === entry || path.startsWith(entry + "/"));
}

async function ended(context: ScriptContext, folder: string, command: readonly string[], input?: string): Promise<Ended> {
  const request = { command, folder, timeLimitSeconds };
  const ran = await answered(context.commands.run(input === undefined ? request : { ...request, input }));
  const exitCode = ran.end.how === "exited" ? ran.end.exitCode : -1;
  return { exitCode, stdout: ran.stdout.text, stderr: ran.stderr.text };
}

async function ranWell(context: ScriptContext, folder: string, command: readonly string[], input?: string): Promise<string> {
  const end = await ended(context, folder, command, input);
  if (end.exitCode !== 0) {
    return fail(command.join(" ") + " failed in " + folder + ": " + end.stderr.trim());
  }
  return end.stdout;
}

export async function folderExists(context: ScriptContext, folder: string): Promise<boolean> {
  return (await ended(context, ".", ["ls", "-d", "--", folder])).exitCode === 0;
}

export async function filesIn(context: ScriptContext, folder: string, ignored: readonly string[]): Promise<Files> {
  const listed = (await ranWell(context, folder, ["find", ".", "-type", "f", "-print0"]))
    .split("\0")
    .filter((path) => path !== "")
    .map((path) => path.slice(2))
    .filter((path) => !isIgnored(path, ignored))
    .sort();
  const files: Record<string, string> = {};
  for (const path of listed) {
    files[path] = await ranWell(context, folder, ["cat", "--", path]);
  }
  return files;
}

export async function place(context: ScriptContext, folder: string, files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      await ranWell(context, folder, ["mkdir", "-p", "--", path.slice(0, slash)]);
    }
    await ranWell(context, folder, ["tee", "--", path], text);
  }
}

export async function madeKind(context: ScriptContext, folder: string): Promise<Kind | undefined> {
  const rows = await answered(context.db.query("select kind from folders where folder = ?", [folder]));
  const kind = rows[0]?.kind;
  return kind === "worktree" || kind === "copy" ? kind : undefined;
}

export async function record(context: ScriptContext, folder: string, kind: Kind): Promise<void> {
  await answered(context.db.execute("insert into folders (folder, kind) values (?, ?)", [folder, kind]));
}

export async function forget(context: ScriptContext, folder: string): Promise<void> {
  await answered(context.db.execute("delete from folders where folder = ?", [folder]));
}

export async function madeAs(context: ScriptContext, folder: string, kind: Kind): Promise<void> {
  const made = await madeKind(context, folder);
  if (made === undefined) {
    fail("The shelf did not make " + folder + ".");
  }
  if (made !== kind) {
    fail("The folder " + folder + " is a " + String(made) + " of the shelf, not a " + kind + ".");
  }
  if (!(await folderExists(context, folder))) {
    fail("The shelf made " + folder + " but it is gone.");
  }
}

export async function branchOf(context: ScriptContext, folder: string): Promise<string> {
  return (await ranWell(context, folder, ["cat", "--", marker])).trim();
}

export async function worktreeState(context: ScriptContext, folder: string): Promise<WorktreeState> {
  const head = (await branches(context))[await branchOf(context, folder)] ?? fail("The worktree " + folder + " has no branch.");
  const committed = (await readCommit(context, head)).files;
  const working = await filesIn(context, folder, await ignoredPaths(context));
  const changed = Object.keys(committed).filter((path) => working[path] !== committed[path]);
  const untracked = Object.keys(working).filter((path) => committed[path] === undefined);
  return { head, changed, untracked };
}
`;

const cutScript = String.raw`import { defineScript, fail } from "../../../../bay/sdk.ts";
import { answered, branches, commitOf, marker, place, readCommit, record, textField, writeBranches } from "./lib/shelf.ts";

export const run = defineScript(async (input, context) => {
  const slice = textField(input, "slice");
  const branch = "forge/" + slice;
  const folder = ".forge/worktrees/" + slice;
  const commit = await commitOf(context, textField(input, "base"));
  const all = await branches(context);
  if (all[branch] !== undefined) {
    fail("The branch " + branch + " is already on the shelf, so the slice " + slice + " is not cut again.");
  }
  await answered(context.files.makeFolder(folder));
  await record(context, folder, "worktree");
  await place(context, folder, { ...(await readCommit(context, commit)).files, [marker]: branch + "\n" });
  await writeBranches(context, { ...all, [branch]: commit });
  return { folder, branch, commit };
});
`;

const statusScript = String.raw`import { defineScript, type ScriptContext } from "../../../../bay/sdk.ts";
import { ancestors, commitOf, madeAs, readCommit, textField, worktreeState } from "./lib/shelf.ts";

async function commitsSince(context: ScriptContext, base: string, head: string): Promise<readonly { readonly hash: string; readonly subject: string }[]> {
  const known = await ancestors(context, base);
  const found: { readonly hash: string; readonly subject: string }[] = [];
  let next: string | undefined = head;
  while (next !== undefined && !known.has(next)) {
    const commit = await readCommit(context, next);
    found.unshift({ hash: next, subject: commit.subject });
    next = commit.parents[0];
  }
  return found;
}

export const run = defineScript(async (input, context) => {
  const folder = textField(input, "folder");
  await madeAs(context, folder, "worktree");
  const base = await commitOf(context, textField(input, "base"));
  const state = await worktreeState(context, folder);
  return {
    head: state.head,
    commits: await commitsSince(context, base, state.head),
    clean: state.changed.length === 0 && state.untracked.length === 0,
    changed: state.changed,
    untracked: state.untracked,
  };
});
`;

const changedScript = String.raw`import { defineScript, type Json } from "../../../../bay/sdk.ts";
import { commitOf, readCommit, textField } from "./lib/shelf.ts";

export const run = defineScript(async (input, context) => {
  const from = (await readCommit(context, await commitOf(context, textField(input, "from")))).files;
  const to = (await readCommit(context, await commitOf(context, textField(input, "to")))).files;
  const deleted = Object.keys(from).filter((path) => to[path] === undefined);
  const added = Object.keys(to).filter((path) => from[path] === undefined);
  const paths: Json[] = Object.keys(from)
    .filter((path) => to[path] !== undefined && to[path] !== from[path])
    .map((path) => ({ path, how: "modified" }));
  const movedFrom = new Set<string>();
  for (const path of added) {
    const origin = deleted.find((old) => !movedFrom.has(old) && from[old] === to[path]);
    if (origin === undefined) {
      paths.push({ path, how: "added" });
    } else {
      movedFrom.add(origin);
      paths.push({ path, how: "renamed", from: origin });
    }
  }
  for (const path of deleted.filter((old) => !movedFrom.has(old))) {
    paths.push({ path, how: "deleted" });
  }
  return { paths };
});
`;

const copyScript = String.raw`import { defineScript, fail } from "../../../../bay/sdk.ts";
import { answered, commitOf, ignoredPaths, isIgnored, madeKind, place, readCommit, record, textField, textsField } from "./lib/shelf.ts";

export const run = defineScript(async (input, context) => {
  const name = textField(input, "name");
  const links = textsField(input, "links");
  const folder = ".forge/copies/" + name;
  if ((await madeKind(context, folder)) !== undefined) {
    fail("The name " + name + " is already a copy on the shelf.");
  }
  const ignored = await ignoredPaths(context);
  for (const link of links) {
    if (!isIgnored(link, ignored)) {
      fail("The shelf does not ignore " + link + ", so the copy does not link to it.");
    }
  }
  const commit = await commitOf(context, textField(input, "commit"));
  await answered(context.files.makeFolder(folder));
  await record(context, folder, "copy");
  await place(context, folder, (await readCommit(context, commit)).files);
  for (const link of links) {
    await answered(context.files.link(folder + "/" + link, link));
  }
  return { folder };
});
`;

const overlayScript = String.raw`import { defineScript } from "../../../../bay/sdk.ts";
import { answered, commitOf, madeAs, place, readCommit, textField, textsField } from "./lib/shelf.ts";

export const run = defineScript(async (input, context) => {
  const folder = textField(input, "folder");
  const paths = textsField(input, "paths");
  await madeAs(context, folder, "copy");
  const files = (await readCommit(context, await commitOf(context, textField(input, "commit")))).files;
  const within = (path: string): readonly string[] =>
    Object.keys(files).filter((file) => file === path || file.startsWith(path + "/"));
  const placed = paths.filter((path) => within(path).length > 0);
  for (const path of paths) {
    await answered(context.files.remove(folder + "/" + path));
  }
  for (const path of placed) {
    await place(context, folder, Object.fromEntries(within(path).map((file) => [file, files[file] ?? ""])));
  }
  return { folder, placed, removed: paths.filter((path) => !placed.includes(path)) };
});
`;

const removeScript = String.raw`import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { ancestors, answered, branches, branchOf, commitOf, folderExists, forget, madeKind, textField, worktreeState, writeBranches } from "./lib/shelf.ts";

export const run = defineScript(async (input, context) => {
  const folder = textField(input, "folder");
  const kind = await madeKind(context, folder);
  if (kind === undefined) {
    return fail("The shelf did not make " + folder + ", so it does not remove it.");
  }
  if (!(await folderExists(context, folder))) {
    await forget(context, folder);
    return { folder, kind: "forgotten", reason: "The folder " + folder + " is gone, so the shelf forgets it and keeps any branch." };
  }
  if (kind === "copy") {
    await answered(context.files.remove(folder));
    await forget(context, folder);
    return { folder, kind: "copy" };
  }
  const into = fieldsOf(input).into;
  if (typeof into !== "string") {
    return fail("Name the branch the worktree " + folder + " must be merged into.");
  }
  const state = await worktreeState(context, folder);
  if (state.changed.length + state.untracked.length > 0) {
    fail("The worktree " + folder + " has changed or untracked files, so the shelf keeps it.");
  }
  if (!(await ancestors(context, await commitOf(context, into))).has(state.head)) {
    fail("The worktree " + folder + " is not merged into " + into + ", so the shelf keeps it.");
  }
  const branch = await branchOf(context, folder);
  await answered(context.files.remove(folder));
  await forget(context, folder);
  const all = { ...(await branches(context)) };
  delete all[branch];
  await writeBranches(context, all);
  return { folder, kind: "worktree", branch };
});
`;

const unbuiltScript = String.raw`import { defineScript, fail } from "../../../../bay/sdk.ts";

export const run = defineScript(() => Promise.resolve(fail("The shelf does not build this action; only cut, status, changed, copy, overlay and remove.")));
`;

const changedWorktreeKept = String.raw`  if (state.changed.length + state.untracked.length > 0) {
    fail("The worktree " + folder + " has changed or untracked files, so the shelf keeps it.");
  }
`;

function manifestOf(name: string): string {
  return String.raw`name: ${name}
version: 1.0.0
description: Keeps commits as files and branches as names in its own folder; a worktrees@1 that a test adds to a copy of the kit.
implements: [worktrees@1]
resources:
  db: { migrations: migrations }
  files:
    read: [.shelf]
    write: [.shelf]
    throwaway: [.forge/worktrees/, .forge/copies/]
  commands:
    - find . -type f -print0
    - cat --
    - tee --
    - mkdir -p --
    - ls -d --
actions:
  cut:
    description: When a test needs a slice's worktree and branch cut from a commit on the shelf.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/cut.ts }]
  status:
    description: When a test needs to know where a slice's worktree stands.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/status.ts }]
  changed:
    description: When a test needs the paths that differ between two commits on the shelf.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/changed.ts }]
  copy:
    description: When a test needs a throwaway copy of a commit's files.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/copy.ts }]
  overlay:
    description: When a test needs some paths of a copy as they are at another commit.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/overlay.ts }]
  remove:
    description: When a test no longer needs a copy, or a clean and merged worktree.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/remove.ts }]
  merge:
    description: When a test would merge a slice; the shelf does not build this action and refuses it.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/unbuilt.ts }]
  set-aside:
    description: When a test would set a slice's work aside; the shelf does not build this action and refuses it.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/unbuilt.ts }]
  apply:
    description: When a test would apply a patch to a copy; the shelf does not build this action and refuses it.
    effects: [read, write, network, spend, delete]
    run: [{ script: scripts/unbuilt.ts }]
`;
}

function readmeOf(name: string): string {
  return String.raw`# ${name}

A made-up worktrees@1 that a test adds to a copy of the kit. It keeps each commit as a file of its paths and texts under .shelf/commits/, and its branches as names in .shelf/branches.json. It builds cut, status, changed, copy, overlay and remove; merge, set-aside and apply refuse.
`;
}

function modeTestOf(name: string): string {
  return String.raw`import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { testWorktrees, type Change, type Files, type Repository, type Start } from "../../interfaces/worktrees/tests/shared.ts";

type Commit = {
  readonly parents: readonly string[];
  readonly subject: string;
  readonly files: Files;
};

type Shelf = {
  readonly project: ModeProject;
  readonly folder: string;
};

function filesOf(value: unknown): Files {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function readJson(file: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  return parsed;
}

async function writeText(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

async function branches(shelf: Shelf): Promise<Files> {
  try {
    return filesOf(await readJson(join(shelf.folder, "branches.json")));
  } catch {
    return {};
  }
}

async function setBranch(shelf: Shelf, branch: string, commit: string): Promise<void> {
  const all = { ...(await branches(shelf)), [branch]: commit };
  await writeText(join(shelf.folder, "branches.json"), JSON.stringify(all, null, 2) + "\n");
}

async function readCommit(shelf: Shelf, hash: string): Promise<Commit> {
  const parsed = await readJson(join(shelf.folder, "commits", hash + ".json"));
  const fields = typeof parsed === "object" && parsed !== null ? parsed : {};
  const parents: unknown = Reflect.get(fields, "parents");
  const subject: unknown = Reflect.get(fields, "subject");
  return {
    parents: Array.isArray(parents) ? parents.filter((parent) => typeof parent === "string") : [],
    subject: typeof subject === "string" ? subject : "",
    files: filesOf(Reflect.get(fields, "files")),
  };
}

async function writeCommit(shelf: Shelf, commit: Commit): Promise<string> {
  const hash = createHash("sha1").update(randomUUID()).update(JSON.stringify(commit)).digest("hex");
  await writeText(join(shelf.folder, "commits", hash + ".json"), JSON.stringify(commit) + "\n");
  return hash;
}

async function writeFiles(root: string, files: Files, deleted: readonly string[]): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await writeText(join(root, path), text);
  }
  for (const path of deleted) {
    await rm(join(root, path), { force: true });
  }
}

async function checkedOut(shelf: Shelf): Promise<string> {
  return (await readFile(join(shelf.folder, "HEAD"), "utf8")).trim();
}

async function branchOfChange(shelf: Shelf, change: Change): Promise<string> {
  if ("branch" in change.on) {
    return change.on.branch;
  }
  return (await readFile(join(shelf.project.root, change.on.folder, ".shelf"), "utf8")).trim();
}

async function committed(shelf: Shelf, change: Change): Promise<string> {
  const branch = await branchOfChange(shelf, change);
  const head = (await branches(shelf))[branch] ?? "";
  const before = (await readCommit(shelf, head)).files;
  const kept = Object.fromEntries(Object.entries(before).filter(([path]) => !change.deleted.includes(path)));
  const commit = await writeCommit(shelf, { parents: [head], subject: change.message, files: { ...kept, ...change.files } });
  if ("folder" in change.on) {
    await writeFiles(join(shelf.project.root, change.on.folder), change.files, change.deleted);
  } else if (branch === (await checkedOut(shelf))) {
    await writeFiles(shelf.project.root, change.files, change.deleted);
  }
  await setBranch(shelf, branch, commit);
  return commit;
}

async function startShelf(start: Start): Promise<Repository> {
  const project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["${name}"] });
  const shelf = { project, folder: join(project.root, ".shelf") };
  await writeText(join(shelf.folder, "HEAD"), start.branch + "\n");
  await writeText(join(shelf.folder, "ignored"), start.ignored.map((path) => path + "\n").join(""));
  await writeFiles(project.root, start.files, []);
  const base = await writeCommit(shelf, { parents: [], subject: "Start the shelf", files: start.files });
  await setBranch(shelf, start.branch, base);
  return {
    project,
    base,
    commit: (change) => committed(shelf, change),
    makeBranch: (branch, commit) => setBranch(shelf, branch, commit),
    headOf: async (branch) => (await branches(shelf))[branch],
    parentsOf: async (commit) => (await readCommit(shelf, commit)).parents,
    filesOf: async (commit) => (await readCommit(shelf, commit)).files,
    checkedOut: () => checkedOut(shelf),
  };
}

testWorktrees({ mode: "${name}", ownData: [".shelf"], start: startShelf });
`;
}

export function shelfFiles(name: string, variant: ShelfVariant): ModeFiles {
  const remove = variant === "keeps a changed worktree" ? removeScript : removeScript.replace(changedWorktreeKept, "");
  const exampleFiles = examples.map((action): readonly [string, string] => [
    `tests/${action}.example.json`,
    exampleTexts[action] ?? "",
  ]);
  return {
    "mode.yaml": manifestOf(name),
    "README.md": readmeOf(name),
    "migrations/0001-folders.sql": migration,
    "scripts/lib/shelf.ts": library,
    "scripts/cut.ts": cutScript,
    "scripts/status.ts": statusScript,
    "scripts/changed.ts": changedScript,
    "scripts/copy.ts": copyScript,
    "scripts/overlay.ts": overlayScript,
    "scripts/remove.ts": remove,
    "scripts/unbuilt.ts": unbuiltScript,
    [`tests/${name}.test.ts`]: modeTestOf(name),
    ...Object.fromEntries(exampleFiles),
  };
}
