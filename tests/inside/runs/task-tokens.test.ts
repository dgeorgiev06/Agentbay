import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { StoredState, Writer } from "../../../bay/runs/run-store.ts";
import { SqliteRunStore } from "../../../bay/runs/sqlite-run-store.ts";
import { checkTaskToken, issueTaskToken } from "../../../bay/runs/task-tokens.ts";
import { temporaryKernelDb } from "./kernel-db-fixture.ts";

type Opened = {
  readonly store: SqliteRunStore;
  readonly file: string;
  readonly writers: Map<string, Writer>;
  readonly remove: () => void;
};

const at = "2026-11-14T09:00:00.000Z";

const now = new Date(at);

function opened(): Opened {
  const { file, remove } = temporaryKernelDb();
  const store = new SqliteRunStore(file);
  return {
    store,
    file,
    writers: new Map(),
    remove: () => {
      store.close();
      remove();
    },
  };
}

async function runWaitingAt(context: Opened, runId: string, stepKey: string): Promise<void> {
  const target = { kind: "action" as const, mode: "writer", name: "compose" };
  const writer = await context.store.createRun({ id: runId, target, input: {}, limit: {}, at }, "test", []);
  context.writers.set(runId, writer);
  await moveTo(context, runId, { status: "waiting", reason: "skill", stepKey });
}

async function moveTo(context: Opened, runId: string, state: StoredState): Promise<void> {
  const writer = context.writers.get(runId);
  assert.ok(writer);
  await context.store.updateRun(writer, { state, at }, []);
}

function stores(context: Opened): Parameters<typeof checkTaskToken>[0] {
  return { tokens: context.store.tokens, runs: context.store };
}

test("a token is 32 random bytes, shown once, and kernel.db keeps only its SHA-256 with the run, step and round", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  const token = await issueTaskToken(context.store.tokens, { runId: "run-1", stepKey: "1#1", round: 1 }, now);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  const database = new DatabaseSync(context.file);
  const rows = database.prepare("select * from task_tokens").all();
  database.close();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0] },
    {
      hash: createHash("sha256").update(token).digest("hex"),
      run_id: "run-1",
      step_key: "1#1",
      round: 1,
      issued_at: at,
    },
  );
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.deepEqual(await checkTaskToken(stores(context), token), {
    ok: true,
    value: { runId: "run-1", stepKey: "1#1", round: 1 },
  });
  context.remove();
});

test("kernel.db keeps one token row per waiting step: issuing again replaces it, and a dead token takes only its row", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  await runWaitingAt(context, "run-2", "0#1");
  const place = { runId: "run-1", stepKey: "1#1", round: 1 };
  await issueTaskToken(context.store.tokens, place, now);
  const first = await issueTaskToken(context.store.tokens, place, now);
  await issueTaskToken(context.store.tokens, { runId: "run-2", stepKey: "0#1", round: 1 }, now);
  const rows = async (): Promise<readonly string[]> =>
    (await context.store.tokens.taskTokens()).map((row) => row.runId);
  assert.deepEqual(await rows(), ["run-1", "run-2"]);
  await moveTo(context, "run-1", { status: "done", output: {} });
  assert.ok(!(await checkTaskToken(stores(context), first)).ok);
  assert.deepEqual(await rows(), ["run-2"]);
  context.remove();
});

test("two steps of one run each keep a token; a new round's token replaces its step's only, and each dies alone", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "w[0].a/0#1");
  const writer = context.writers.get("run-1");
  assert.ok(writer);
  const also = [{ reason: "skill" as const, stepKey: "w[1].a/0#1" }];
  await context.store.updateRun(
    writer,
    { state: { status: "waiting", reason: "skill", stepKey: "w[0].a/0#1", also }, at },
    [],
  );
  const first = await issueTaskToken(context.store.tokens, { runId: "run-1", stepKey: "w[0].a/0#1", round: 1 }, now);
  const second = await issueTaskToken(context.store.tokens, { runId: "run-1", stepKey: "w[1].a/0#1", round: 1 }, now);
  const keys = async (): Promise<readonly string[]> =>
    (await context.store.tokens.taskTokens()).map((row) => row.stepKey).sort();
  assert.deepEqual(await keys(), ["w[0].a/0#1", "w[1].a/0#1"]);
  assert.ok((await checkTaskToken(stores(context), first)).ok);
  assert.ok((await checkTaskToken(stores(context), second)).ok);
  await issueTaskToken(context.store.tokens, { runId: "run-1", stepKey: "w[0].a/0#2", round: 2 }, now);
  assert.deepEqual(await keys(), ["w[0].a/0#2", "w[1].a/0#1"]);
  assert.ok(!(await checkTaskToken(stores(context), first)).ok);
  await context.store.updateRun(
    writer,
    { state: { status: "waiting", reason: "skill", stepKey: "w[0].a/0#2" }, at },
    [],
  );
  const dead = await checkTaskToken(stores(context), second);
  assert.ok(!dead.ok);
  assert.match(dead.problems[0]?.message ?? "", /the run is waiting for skill at w\[0\]\.a\/0#2/);
  assert.deepEqual(await keys(), ["w[0].a/0#2"]);
  context.remove();
});

test("a kernel.db of the first version gains the token table and keeps its runs", async () => {
  const { file, remove } = temporaryKernelDb();
  const first = new SqliteRunStore(file);
  const target = { kind: "action" as const, mode: "writer", name: "compose" };
  await first.createRun({ id: "old-run", target, input: {}, limit: {}, at }, "test", []);
  first.close();
  const database = new DatabaseSync(file);
  database.exec(
    "drop table task_tokens; alter table runs drop column target_caller; alter table runs drop column kept; " +
      "alter table steps drop column kept; alter table runs drop column waiting_also; pragma user_version = 1;",
  );
  database.close();
  const reopened = new SqliteRunStore(file);
  assert.equal((await reopened.readRun("old-run"))?.id, "old-run");
  assert.deepEqual(await reopened.tokens.taskTokens(), []);
  reopened.close();
  remove();
});
