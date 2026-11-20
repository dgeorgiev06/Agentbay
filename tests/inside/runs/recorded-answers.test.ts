import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Keeping } from "../../../bay/generated/mode.ts";
import { failedWith, succeededWith, unplacedProblem } from "../../../bay/outcome.ts";
import type { AnswerRule, Recording } from "../../../bay/runs/run-store.ts";
import { SqliteRunStore } from "../../../bay/runs/sqlite-run-store.ts";
import { answer, notesFlow, withFlow } from "../../runs-fixture.ts";
import { harness, problemsOf, runOf } from "./engine-harness.ts";
import { faultInjector, temporaryKernelDb } from "./kernel-db-fixture.ts";

const at = "2026-11-14T09:00:00.000Z";

const now = new Date(at);

const target = { kind: "action" as const, mode: "writer", name: "compose" };

const twoDrafts = [
  {
    id: "each",
    foreach: "$trigger",
    sideBySide: 2,
    steps: [{ id: "write", action: "draft", input: { topic: "$item" } }],
  },
];

function allowing(kept: Keeping): AnswerRule {
  return () => succeededWith({ kept });
}

function recorded(stepKey: string, text: string): Parameters<SqliteRunStore["recordAnswer"]>[0] {
  return { runId: "run-1", stepKey, submission: answer({ text }), at };
}

function rows(file: string): readonly Record<string, unknown>[] {
  const database = new DatabaseSync(file, { readOnly: true });
  const found = database.prepare("select * from answers order by rowid").all();
  database.close();
  return found;
}

test("an answer is recorded with the lock when the run is free, and without it when another call holds it", async () => {
  const { file, remove } = temporaryKernelDb();
  const store = new SqliteRunStore(file);
  const writer = await store.createRun({ id: "run-1", target, input: {}, limit: {}, at }, "advancer", []);
  const lock = { owner: "submitter", now };
  const whileHeld = await store.recordAnswer(recorded("a#1", "first"), lock, allowing("as-text"));
  assert.deepEqual(whileHeld, { status: "recorded" });
  assert.equal(await store.releaseUnlessAnswered(writer), false);
  await store.forgetAnswer(writer, "a#1", []);
  assert.equal(await store.releaseUnlessAnswered(writer), true);
  const whenFree: Recording = await store.recordAnswer(recorded("b#1", "second"), lock, allowing("as-text"));
  assert.deepEqual(whenFree, { status: "taken", writer: { runId: "run-1", owner: "submitter" } });
  assert.deepEqual(
    (await store.recordedAnswers("run-1")).map((each) => [each.stepKey, each.submission.output]),
    [["b#1", { text: "second" }]],
  );
  store.close();
  remove();
});

test("a refused answer writes nothing, and a lock taken from someone else lets go even with answers left", async () => {
  const { file, remove } = temporaryKernelDb();
  const store = new SqliteRunStore(file);
  const writer = await store.createRun({ id: "run-1", target, input: {}, limit: {}, at }, "advancer", []);
  const refusing: AnswerRule = (_run, keys) => failedWith([unplacedProblem(`refused with ${String(keys.size)}`)]);
  const lock = { owner: "submitter", now };
  assert.deepEqual(await store.recordAnswer(recorded("a#1", "first"), lock, refusing), {
    status: "refused",
    problems: [unplacedProblem("refused with 0")],
  });
  assert.deepEqual(rows(file), []);
  await store.recordAnswer(recorded("a#1", "first"), lock, allowing("as-text"));
  const stale = { owner: "taker", now: new Date(now.getTime() + 11 * 60_000) };
  assert.equal((await store.acquire("run-1", stale.owner, stale.now)).status, "acquired");
  assert.equal(await store.releaseUnlessAnswered(writer), true);
  assert.equal((await store.recordedAnswers("run-1")).length, 1);
  store.close();
  remove();
});

test("an answer of a step kept packed is stored packed and read back whole", async () => {
  const { file, remove } = temporaryKernelDb();
  const store = new SqliteRunStore(file);
  await store.createRun({ id: "run-1", target, input: {}, limit: {}, at }, "advancer", []);
  await store.recordAnswer(recorded("a#1", "a secret note"), { owner: "submitter", now }, allowing("kept-packed"));
  const [row] = rows(file);
  assert.equal(row?.["kept"], "kept-packed");
  assert.ok(!String(row["submission"]).includes("a secret note"));
  assert.deepEqual((await store.recordedAnswers("run-1"))[0]?.submission.output, { text: "a secret note" });
  store.close();
  remove();
});

test("a record that finds kernel.db busy is a refusal to try again, and nothing is recorded", async () => {
  const steps = [
    { id: "each", foreach: "$trigger", sideBySide: 2, steps: [{ id: "write", action: "draft", input: {} }] },
  ];
  const { engine, file, freshEngine, close } = await harness({ changes: withFlow(steps) });
  const id = runOf(await engine.startWorkflow({ mode: "notes", path: "workflows/flow.yaml" }, [1, 2])).id;
  const impatient = new SqliteRunStore(file, { busyMilliseconds: 50 });
  const before = await impatient.readRun(id);
  const blocker = new DatabaseSync(file);
  blocker.exec("begin immediate");
  const refused = problemsOf(
    await freshEngine({ store: impatient }).submit(id, "each[0].write/0#1", answer({ text: "long enough text" })),
  );
  blocker.exec("rollback");
  blocker.close();
  assert.deepEqual(refused, [`Another engine is writing run ${id}; try again.`]);
  assert.deepEqual(await impatient.recordedAnswers(id), []);
  assert.deepEqual(await impatient.readRun(id), before);
  impatient.close();
  close();
});

test("the engine refuses an answer for a skill step the waiting run does not wait for", async () => {
  const { engine, store, close } = await harness({ changes: withFlow(twoDrafts) });
  const id = runOf(await engine.startWorkflow(notesFlow, ["tea", "coffee"])).id;
  const lock = await store.acquire(id, "test", now);
  assert.ok(lock.status === "acquired");
  const state = { status: "waiting" as const, reason: "budget" as const, stepKey: "each[1].write/0" };
  await store.updateRun(lock.writer, { state, at }, []);
  await store.release(lock.writer);
  const refused = problemsOf(await engine.submit(id, "each[1].write/0#1", answer({ text: "long enough text" })));
  assert.match(refused.join(" "), /is not waiting for skill at step each\[1\]\.write\/0#1; it is waiting for budget/);
  assert.deepEqual(await store.recordedAnswers(id), []);
  close();
});

test("an answer left behind for round 1 is dropped with its reason once the step is in round 2", async () => {
  const { engine, store, clock, freshEngine, reopen, close } = await harness();
  const id = runOf(await engine.startAction("notes.draft", {})).id;
  const crashing = faultInjector(store, { at: 3, when: "before" });
  await assert.rejects(freshEngine({ store: crashing }).submit(id, "0#1", answer({ text: "short" })), /simulated/);
  assert.deepEqual(crashing.writes, ["recordAnswer", "saveStepDetail", "forgetAnswer"]);
  clock.advance(11 * 60_000);
  const fresh = reopen();
  const resumed = runOf(await freshEngine({ store: fresh }).resume(id));
  assert.ok(resumed.state.status === "waiting" && resumed.state.waiting.stepKey === "0#2");
  assert.deepEqual(await fresh.recordedAnswers(id), []);
  const dropped = (await fresh.readEvents(id)).filter((event) => event.kind === "answer.dropped");
  assert.equal(dropped.length, 1);
  assert.match(JSON.stringify(dropped[0]?.detail), /"stepKey":"0#1".*not waiting for skill at step 0#1/);
  close();
});
