import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SqliteRunStore } from "../../../bay/runs/sqlite-run-store.ts";
import { answer, notesFlow, withFlow, type FakeRunner } from "../../runs-fixture.ts";
import { eventKinds, harness, problemsOf, runOf, waitingOf } from "./engine-harness.ts";
import { databaseRows, faultInjector, type DatabaseRows, type FaultPoint } from "./kernel-db-fixture.ts";

const threeStepWrites = [
  "createRun",
  "saveStepInput",
  "heartbeat",
  "saveStepOutput",
  "saveStepInput",
  "heartbeat",
  "saveStepOutput",
  "saveStepInput",
  "heartbeat",
  "saveStepOutput",
  "updateRun",
  "releaseUnlessAnswered",
];

function executionsByStep(runner: FakeRunner): readonly number[] {
  const counts = [0, 0, 0];
  for (const call of runner.calls) {
    const index = Number(call.place.stepKey);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

async function cleanWrites(action: string): Promise<readonly string[]> {
  const { store, freshEngine, close } = await harness();
  const counting = faultInjector(store);
  runOf(await freshEngine({ store: counting, runId: "clean" }).startAction(`notes.${action}`, { count: 1 }));
  close();
  return counting.writes;
}

async function resumedAfterCrash(action: string, point: FaultPoint): Promise<void> {
  const { store, runner, clock, freshEngine, reopen, close } = await harness();
  const crashing = freshEngine({ store: faultInjector(store, point), runId: "crash" });
  await assert.rejects(crashing.startAction(`notes.${action}`, { count: 1 }), /simulated crash/);
  const fresh = reopen();
  const afterCrash = await fresh.readRun("crash");
  if (afterCrash === undefined) {
    assert.deepEqual([point.at, runner.calls.length], [1, 0]);
    close();
    return;
  }
  const unfinished = afterCrash.steps.filter((step) => step.status === "started").map((step) => step.key);
  assert.ok(unfinished.length <= 1, `at most one step can be unfinished: ${unfinished.join(", ")}`);
  clock.advance(11 * 60_000);
  const resumer = freshEngine({ store: fresh });
  let result = await resumer.resume("crash");
  if (!result.ok) {
    assert.match(problemsOf(result)[0] ?? "", /has ended \(done\)/);
    assert.deepEqual((await fresh.readRun("crash"))?.state, { status: "done", output: { count: 5 } });
    close();
    return;
  }
  const label = `${action} crashed ${point.when} write ${String(point.at)}`;
  const [unfinishedKey] = unfinished;
  if (action === "save" && unfinishedKey !== undefined) {
    assert.deepEqual(
      [waitingOf(result).reason, waitingOf(result).stepKey],
      ["owner", unfinishedKey],
      `${label}: a write step that may have run waits for the owner`,
    );
    assert.ok(
      executionsByStep(runner).every((count) => count <= 1),
      `${label}: nothing ran twice before the owner said`,
    );
    result = await resumer.resume("crash", { rerunUnfinished: true });
  }
  assert.deepEqual(runOf(result).state, { status: "done", output: { count: 5 } }, label);
  for (const [index, count] of executionsByStep(runner).entries()) {
    const allowed = unfinished.includes(String(index)) ? 2 : 1;
    assert.ok(count >= 1 && count <= allowed, `${label}: step ${String(index)} ran ${String(count)} times`);
  }
  close();
}

for (const action of ["copy", "save"]) {
  test(`a crash before or after any write of the three-step ${action} action resumes on a fresh engine`, async () => {
    const writes = await cleanWrites(action);
    assert.deepEqual(writes, threeStepWrites);
    for (let at = 1; at <= writes.length; at += 1) {
      for (const when of ["before", "after"] as const) {
        await resumedAfterCrash(action, { at, when });
      }
    }
  });
}

async function rowsAfterFault(
  point: FaultPoint,
): Promise<{ readonly writes: readonly string[]; readonly rows: DatabaseRows }> {
  const { store, file, freshEngine, close } = await harness();
  const faulty = faultInjector(store, point);
  const crashing = freshEngine({ store: faulty, owner: "engine-1", runId: "crash" });
  await assert.rejects(crashing.startAction("notes.copy", { count: 1 }), /simulated crash/);
  const rows = databaseRows(file);
  close();
  return { writes: faulty.writes, rows };
}

function stepsOf(rows: DatabaseRows): readonly unknown[] {
  return (rows.steps ?? []).map((row) => [row.key, row.status]);
}

function eventKindsOf(rows: DatabaseRows): readonly unknown[] {
  return (rows.events ?? []).map((row) => row.kind);
}

test("a fault at write 5 stops the run there, and kernel.db holds exactly the writes before it", async () => {
  const beforeFive = await rowsAfterFault({ at: 5, when: "before" });
  assert.deepEqual(beforeFive.writes, ["createRun", "saveStepInput", "heartbeat", "saveStepOutput", "saveStepInput"]);
  assert.deepEqual(
    (beforeFive.rows.runs ?? []).map((row) => [row.id, row.status, row.lock_owner]),
    [["crash", "running", "engine-1"]],
  );
  assert.deepEqual(stepsOf(beforeFive.rows), [["0", "done"]]);
  assert.deepEqual(eventKindsOf(beforeFive.rows), ["run.started", "step.started", "step.finished"]);
  const afterFour = await rowsAfterFault({ at: 4, when: "after" });
  assert.deepEqual(afterFour.writes, ["createRun", "saveStepInput", "heartbeat", "saveStepOutput"]);
  assert.deepEqual(afterFour.rows, beforeFive.rows);
  const afterFive = await rowsAfterFault({ at: 5, when: "after" });
  assert.deepEqual(stepsOf(afterFive.rows), [
    ["0", "done"],
    ["1", "started"],
  ]);
  assert.deepEqual(eventKindsOf(afterFive.rows), ["run.started", "step.started", "step.finished", "step.started"]);
});

test("a lock left by a dead engine is taken over after ten minutes, and the takeover is an event", async () => {
  const { store, clock, freshEngine, reopen, close } = await harness();
  const dying = faultInjector(store, { at: 4, when: "before" });
  const dead = freshEngine({ store: dying, owner: "engine-1", runId: "dead" });
  await assert.rejects(dead.startAction("notes.save", { count: 1 }), /simulated crash/);
  assert.deepEqual(dying.writes, ["createRun", "saveStepInput", "heartbeat", "saveStepOutput"]);
  const fresh = reopen();
  const resumer = freshEngine({ store: fresh, owner: "engine-2" });
  clock.advance(9 * 60_000);
  assert.match(problemsOf(await resumer.resume("dead"))[0] ?? "", /being advanced by engine-1/);
  clock.advance(2 * 60_000);
  assert.deepEqual(waitingOf(await resumer.resume("dead")), {
    reason: "owner",
    stepKey: "0",
    question:
      "Step 0 started and did not finish, and action save of mode notes has the effects read, write, so running it " +
      "again could repeat them. Resume with rerunUnfinished to run it again, or stop the run.",
  });
  const takeover = (await fresh.readEvents("dead")).find((event) => event.kind === "lock.taken-over");
  assert.deepEqual(takeover?.detail, {
    previousOwner: "engine-1",
    heartbeatAt: "2026-11-14T09:00:00.000Z",
    owner: "engine-2",
  });
  const stopped = runOf(await resumer.stop("dead"));
  assert.deepEqual(stopped.state, { status: "failed", reason: "The owner stopped the run." });
  close();
});

test("a crash right after a submission is saved runs its checks on resume and refuses it a second time", async () => {
  const { engine, store, runner, clock, freshEngine, reopen, close } = await harness();
  const id = runOf(await engine.startAction("notes.draft", {})).id;
  const crashing = faultInjector(store, { at: 2, when: "after" });
  await assert.rejects(
    freshEngine({ store: crashing }).submit(id, "0#1", answer({ text: "long enough text" })),
    /simulated/,
  );
  assert.deepEqual(crashing.writes, ["recordAnswer", "saveStepDetail"]);
  assert.deepEqual(runner.calls, []);
  clock.advance(11 * 60_000);
  const resumer = freshEngine({ store: reopen() });
  assert.match(
    problemsOf(await resumer.submit(id, "0#1", answer({ text: "another text" })))[0] ?? "",
    /already has a submission/,
  );
  assert.deepEqual(runOf(await resumer.resume(id)).state, { status: "done", output: { text: "long enough text" } });
  assert.equal(runner.calls.length, 1);
  close();
});

test("a crash right after a decision is saved applies it on resume and refuses a second decision", async () => {
  const changes = withFlow([{ id: "keep", approval: "Keep?", show: "$trigger" }]);
  const { engine, store, clock, freshEngine, reopen, close } = await harness({ changes });
  const waiting = waitingOf(await engine.startWorkflow(notesFlow, "content"));
  assert.ok(waiting.reason === "approval");
  const decision = { hash: waiting.hash, decision: "approve", by: "owner" } as const;
  const crashing = faultInjector(store, { at: 2, when: "after" });
  await assert.rejects(freshEngine({ store: crashing }).approve("run-1", "keep", decision), /simulated/);
  assert.deepEqual(crashing.writes, ["acquire", "saveStepDetail"]);
  clock.advance(11 * 60_000);
  const fresh = reopen();
  const resumer = freshEngine({ store: fresh });
  assert.match(problemsOf(await resumer.approve("run-1", "keep", decision))[0] ?? "", /already has a decision/);
  assert.deepEqual(runOf(await resumer.resume("run-1")).state, { status: "done", output: "content" });
  assert.ok((await eventKinds(fresh, "run-1")).includes("approval.recorded"));
  close();
});

test("a database that stays busy is a refusal to try again, not an exception", async () => {
  const { engine, file, freshEngine, close } = await harness({ changes: { config: { budget: { items: 1 } } } });
  const id = runOf(await engine.startAction("notes.spend", { measure: "items" })).id;
  const blocker = new DatabaseSync(file);
  blocker.exec("begin immediate");
  const impatient = new SqliteRunStore(file, { busyMilliseconds: 50 });
  assert.deepEqual(problemsOf(await freshEngine({ store: impatient }).extendBudget(id, { items: 5 })), [
    `Another engine is writing run ${id}; try again.`,
  ]);
  blocker.exec("rollback");
  blocker.close();
  impatient.close();
  close();
});
