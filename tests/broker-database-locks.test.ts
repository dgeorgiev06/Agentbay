import assert from "node:assert/strict";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { stringify } from "yaml";
import { databaseLockWaitMilliseconds } from "../bay/database-lock.ts";
import type { Kernel } from "../bay/kernel.ts";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";

type Opened = {
  readonly project: Project;
  readonly kernel: Kernel;
};

type Busy = {
  readonly file: string;
  readonly held: string;
  readonly action: string;
};

const unnamedFile = join(".agentbay", "data", "jotter.db");

const releaseAfterMilliseconds = 1000;

const releaseAfterAllHaveStartedMilliseconds = 2500;

const todo = {
  name: "jotter",
  version: "1.0.0",
  description: "Keeps todos in its own database and in partitions of it.",
  resources: { db: { migrations: "migrations" } },
  actions: {
    add: {
      description: "When a test adds a todo to the mode's own database.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/add.ts" }],
    },
    file: {
      description: "When a test adds a todo to a partition named in the input.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/file.ts" }],
    },
    count: {
      description: "When a test counts the todos of a partition named in the input.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read"],
      run: [{ script: "scripts/count.ts" }],
    },
  },
};

const addScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const added = await context.db.execute("insert into todos (title) values (?)", [JSON.stringify(input)]);',
  "  return added.ok ? { added: true } : fail(added.message);",
  "});",
  "",
].join("\n");

const fileScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const partition = context.db.partition(String(input.partition));",
  "  const migrated = await partition.migrate();",
  "  if (!migrated.ok) {",
  "    return fail(migrated.message);",
  "  }",
  '  const added = await partition.execute("insert into todos (title) values (?)", [JSON.stringify(input)]);',
  "  return added.ok ? { added: true } : fail(added.message);",
  "});",
  "",
].join("\n");

const countScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const partition = context.db.partition(String(input.partition));",
  '  const counted = await partition.query("select count(*) as todos from todos");',
  "  return counted.ok ? { todos: counted.value[0].todos } : fail(counted.message);",
  "});",
  "",
].join("\n");

async function opened(): Promise<Opened> {
  const project = await makeProject();
  const folder = "components/modes/jotter";
  await project.write(`${folder}/mode.yaml`, stringify(todo));
  await project.write(`${folder}/schemas/anything.json`, '{ "type": "object" }\n');
  await project.write(`${folder}/migrations/0001-todos.sql`, "create table todos (title text not null);\n");
  await project.write(`${folder}/scripts/add.ts`, addScript);
  await project.write(`${folder}/scripts/file.ts`, fileScript);
  await project.write(`${folder}/scripts/count.ts`, countScript);
  return { project, kernel: await openKernel(project) };
}

async function withTodo(body: (opened: Opened) => Promise<void>): Promise<void> {
  const setup = await opened();
  try {
    await body(setup);
  } finally {
    setup.kernel.close();
    await setup.project.remove();
  }
}

async function ended(kernel: Kernel, action: string, input: Record<string, string | number>): Promise<string> {
  const run = await kernel.runs.start({ action }, input);
  assert.ok(run.ok, JSON.stringify(run));
  const { state } = run.value;
  if (state.status === "done" || state.status === "failed") {
    return state.status === "done" ? "done" : state.reason;
  }
  return assert.fail(`The run ended neither done nor failed: ${JSON.stringify(state)}`);
}

async function done(kernel: Kernel, action: string, input: Record<string, string | number>): Promise<void> {
  assert.equal(await ended(kernel, action, input), "done");
}

function counts(file: string): { readonly todos: number; readonly migrations: number } {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const todos = database.prepare("select count(*) as rows from todos").get();
    const migrations = database.prepare("select count(*) as rows from _migrations").get();
    return { todos: Number(todos?.rows), migrations: Number(migrations?.rows) };
  } finally {
    database.close();
  }
}

async function removedDatabase(file: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${file}${suffix}`, { force: true });
  }
}

function ownerOnlyFile(file: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, "a", 0o600));
}

function lockedFile(file: string, lock: "exclusive" | "immediate", wal: boolean): DatabaseSync {
  ownerOnlyFile(file);
  const holder = new DatabaseSync(file);
  if (wal) {
    holder.exec("pragma journal_mode = wal");
  }
  holder.exec(`begin ${lock}`);
  return holder;
}

function releasedSoon(holder: DatabaseSync, milliseconds = releaseAfterMilliseconds): void {
  setTimeout(() => {
    holder.exec("commit");
    holder.close();
  }, milliseconds);
}

const callsAtOnce = [0, 1, 2, 3, 4, 5];

const allDone = callsAtOnce.map(() => "done");

const rounds = [
  { name: "while the test holds the file at first", held: true },
  { name: "racing each other alone", held: false },
];

async function firstUsesAtOnce(file: string, held: boolean, started: () => Promise<readonly string[]>): Promise<void> {
  if (held) {
    releasedSoon(lockedFile(file, "exclusive", false));
  }
  assert.deepEqual(await started(), allDone);
  assert.deepEqual(counts(file), { todos: callsAtOnce.length, migrations: 1 });
}

test("first uses of a mode's database at the same moment all run, and the schema is migrated once", async () => {
  await withTodo(async ({ project, kernel }) => {
    const file = join(project.root, unnamedFile);
    for (const round of rounds) {
      const started = () => Promise.all(callsAtOnce.map((call) => ended(kernel, "jotter.add", { call })));
      await firstUsesAtOnce(file, round.held, started);
      await removedDatabase(file);
    }
  });
});

test("first uses of a fresh partition at the same moment all run, and the partition is migrated once", async () => {
  await withTodo(async ({ project, kernel }) => {
    for (const [index, round] of rounds.entries()) {
      const partition = `round-${String(index)}`;
      const file = join(project.root, ".agentbay", "data", `jotter--${partition}.db`);
      const started = () => Promise.all(callsAtOnce.map((call) => ended(kernel, "jotter.file", { partition, call })));
      await firstUsesAtOnce(file, round.held, started);
    }
  });
});

test("writes at the same moment after the first use all land, also while the test is writing", async () => {
  await withTodo(async ({ project, kernel }) => {
    const file = join(project.root, unnamedFile);
    await done(kernel, "jotter.add", { call: 0 });
    releasedSoon(lockedFile(file, "immediate", true));
    const runs = callsAtOnce.map((call) => ended(kernel, "jotter.add", { call: call + 1 }));
    assert.deepEqual(await Promise.all(runs), allDone);
    assert.deepEqual(counts(file), { todos: callsAtOnce.length + 1, migrations: 1 });
  });
});

test("a first migration that several actions meet while the database is being written runs once", async () => {
  await withTodo(async ({ project, kernel }) => {
    const file = join(project.root, unnamedFile);
    ownerOnlyFile(file);
    const holder = new DatabaseSync(file);
    holder.exec("pragma journal_mode = wal");
    holder.exec("create table _migrations (name text primary key, applied_at text not null)");
    holder.exec("begin immediate");
    releasedSoon(holder, releaseAfterAllHaveStartedMilliseconds);
    const runs = callsAtOnce.map((call) => ended(kernel, "jotter.add", { call }));
    assert.deepEqual(await Promise.all(runs), allDone);
    assert.deepEqual(counts(file), { todos: callsAtOnce.length, migrations: 1 });
  });
});

test("a read waits while another connection holds the database, then answers", async () => {
  await withTodo(async ({ project, kernel }) => {
    const file = join(project.root, ".agentbay", "data", "jotter--kept.db");
    const holder = lockedFile(file, "exclusive", false);
    holder.exec("create table todos (title text not null)");
    releasedSoon(holder);
    await done(kernel, "jotter.count", { partition: "kept" });
  });
});

function busySentence(busy: Busy): string {
  return (
    `The database ${busy.file} stayed locked by another connection for ${String(databaseLockWaitMilliseconds)} ms, ` +
    `the longest the broker waits, so ${busy.held} did not run. Run the action ${busy.action} again.`
  );
}

test("when the database stays locked past the wait, the action fails with a sentence a person can act on", async () => {
  await withTodo(async ({ project, kernel }) => {
    const unnamed = lockedFile(join(project.root, unnamedFile), "exclusive", false);
    const keptFile = join(".agentbay", "data", "jotter--kept.db");
    const kept = lockedFile(join(project.root, keptFile), "exclusive", false);
    kept.exec("create table todos (title text not null)");
    const [added, counted] = await Promise.all([
      ended(kernel, "jotter.add", { call: 0 }),
      ended(kernel, "jotter.count", { partition: "kept" }),
    ]);
    assert.equal(added, busySentence({ file: unnamedFile, held: "its migrations", action: "jotter.add" }));
    assert.equal(counted, busySentence({ file: keptFile, held: "the statement", action: "jotter.count" }));
    for (const holder of [unnamed, kept]) {
      holder.exec("commit");
      holder.close();
    }
    await done(kernel, "jotter.add", { call: 1 });
    await done(kernel, "jotter.count", { partition: "kept" });
  });
});
