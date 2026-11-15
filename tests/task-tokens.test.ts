import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { StoredState, Writer } from "../bay/run-store.ts";
import { SqliteRunStore } from "../bay/sqlite-run-store.ts";
import { checkTaskToken, issueTaskToken } from "../bay/task-tokens.ts";
import { problemText } from "../bay/outcome.ts";

type Opened = {
  readonly store: SqliteRunStore;
  readonly file: string;
  readonly writers: Map<string, Writer>;
  readonly remove: () => void;
};

const at = "2026-11-14T09:00:00.000Z";

const now = new Date(at);

function opened(): Opened {
  const folder = mkdtempSync(join(tmpdir(), "agentbay-tokens-"));
  const file = join(folder, "kernel.db");
  const store = new SqliteRunStore(file);
  return {
    store,
    file,
    writers: new Map(),
    remove: () => {
      store.close();
      rmSync(folder, { recursive: true, force: true });
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
  return { tokens: context.store, runs: context.store };
}

test("a token is 32 random bytes, shown once, and kernel.db keeps only its SHA-256 with the run, step and round", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  const token = await issueTaskToken(context.store, { runId: "run-1", stepKey: "1#1", round: 1 }, now);
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

test("a wrong token is refused", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  const token = await issueTaskToken(context.store, { runId: "run-1", stepKey: "1#1", round: 1 }, now);
  for (const wrong of ["", "nope", `${token}x`, token.slice(1), token.toUpperCase()]) {
    const checked = await checkTaskToken(stores(context), wrong);
    assert.ok(!checked.ok, wrong);
    assert.match(problemText(checked.problems), /The token is not valid/);
  }
  context.remove();
});

test("a token dies when its step finishes", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  const token = await issueTaskToken(context.store, { runId: "run-1", stepKey: "1#1", round: 1 }, now);
  await moveTo(context, "run-1", { status: "done", output: {} });
  const checked = await checkTaskToken(stores(context), token);
  assert.ok(!checked.ok);
  assert.match(problemText(checked.problems), /no longer waiting for it \(the run is done\)/);
  assert.deepEqual(await context.store.taskTokens(), []);
  context.remove();
});

test("a token from an earlier round is refused once the round changes", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  const token = await issueTaskToken(context.store, { runId: "run-1", stepKey: "1#1", round: 1 }, now);
  await moveTo(context, "run-1", { status: "waiting", reason: "skill", stepKey: "1#2" });
  const checked = await checkTaskToken(stores(context), token);
  assert.ok(!checked.ok);
  assert.match(problemText(checked.problems), /the run is waiting for skill at 1#2/);
  context.remove();
});

test("issuing the task again replaces the token: the old one cannot be replayed", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  const place = { runId: "run-1", stepKey: "1#1", round: 1 };
  const first = await issueTaskToken(context.store, place, now);
  const second = await issueTaskToken(context.store, place, now);
  assert.notEqual(first, second);
  assert.ok(!(await checkTaskToken(stores(context), first)).ok);
  assert.ok((await checkTaskToken(stores(context), second)).ok);
  assert.equal((await context.store.taskTokens()).length, 1);
  context.remove();
});

test("tokens of different runs live side by side", async () => {
  const context = opened();
  await runWaitingAt(context, "run-1", "1#1");
  await runWaitingAt(context, "run-2", "0#1");
  const first = await issueTaskToken(context.store, { runId: "run-1", stepKey: "1#1", round: 1 }, now);
  const second = await issueTaskToken(context.store, { runId: "run-2", stepKey: "0#1", round: 1 }, now);
  const checkedFirst = await checkTaskToken(stores(context), first);
  const checkedSecond = await checkTaskToken(stores(context), second);
  assert.ok(checkedFirst.ok && checkedFirst.value.runId === "run-1");
  assert.ok(checkedSecond.ok && checkedSecond.value.runId === "run-2");
  await context.store.removeTaskTokens("run-1");
  assert.ok(!(await checkTaskToken(stores(context), first)).ok);
  assert.ok((await checkTaskToken(stores(context), second)).ok);
  context.remove();
});

test("a kernel.db of the first version gains the token table and keeps its runs", async () => {
  const folder = mkdtempSync(join(tmpdir(), "agentbay-tokens-"));
  const file = join(folder, "kernel.db");
  const first = new SqliteRunStore(file);
  const target = { kind: "action" as const, mode: "writer", name: "compose" };
  await first.createRun({ id: "old-run", target, input: {}, limit: {}, at }, "test", []);
  first.close();
  const database = new DatabaseSync(file);
  database.exec("drop table task_tokens; alter table runs drop column target_caller; pragma user_version = 1;");
  database.close();
  const reopened = new SqliteRunStore(file);
  assert.equal((await reopened.readRun("old-run"))?.id, "old-run");
  assert.deepEqual(await reopened.taskTokens(), []);
  reopened.close();
  rmSync(folder, { recursive: true, force: true });
});
