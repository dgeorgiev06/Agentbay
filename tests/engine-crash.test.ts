import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import { numberField } from "../bay/json.ts";
import type { Engine } from "../bay/engine.ts";
import { SqliteRunStore, type RunStore } from "../bay/run-store.ts";
import type { EngineResult } from "../bay/run-state.ts";
import {
  eventKinds,
  finished,
  harness,
  problemsOf,
  runOf,
  waitingOf,
  type FakeRunner,
  type Script,
  answer,
} from "./engine-fixture.ts";
import { MemoryRunStore } from "./memory-run-store.ts";

type CrashPoint = {
  readonly at: number;
  readonly when: "before" | "after";
};

type CrashingStore = RunStore & {
  readonly operations: readonly string[];
};

const crashMessage = "simulated crash";

function crashingStore(inner: RunStore, point: CrashPoint | undefined): CrashingStore {
  const operations: string[] = [];
  let dead = false;
  const crash = (): never => {
    dead = true;
    throw new Error(crashMessage);
  };
  const write = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    if (dead) {
      throw new Error(crashMessage);
    }
    operations.push(name);
    if (point?.at === operations.length && point.when === "before") {
      crash();
    }
    const result = await operation();
    if (point?.at === operations.length && point.when === "after") {
      crash();
    }
    return result;
  };
  const read = async <T>(operation: () => Promise<T>): Promise<T> => (dead ? crash() : operation());
  return {
    operations,
    createRun: (run, owner, events) => write("createRun", () => inner.createRun(run, owner, events)),
    saveStepInput: (writer, start, events) => write("saveStepInput", () => inner.saveStepInput(writer, start, events)),
    saveStepOutput: (writer, end, events) => write("saveStepOutput", () => inner.saveStepOutput(writer, end, events)),
    saveStepDetail: (writer, change, events) =>
      write("saveStepDetail", () => inner.saveStepDetail(writer, change, events)),
    updateRun: (writer, patch, events) => write("updateRun", () => inner.updateRun(writer, patch, events)),
    append: (event) => write("append", () => inner.append(event)),
    acquire: (runId, owner, now) => write("acquire", () => inner.acquire(runId, owner, now)),
    heartbeat: (writer, now) => write("heartbeat", () => inner.heartbeat(writer, now)),
    release: (writer) => write("release", () => inner.release(writer)),
    readRun: (runId) => read(() => inner.readRun(runId)),
    listRuns: (status) => read(() => inner.listRuns(status)),
    readEvents: (runId) => read(() => inner.readEvents(runId)),
  };
}

function executionsByStep(runner: FakeRunner): readonly number[] {
  const counts = [0, 0, 0];
  for (const call of runner.calls) {
    counts[call.place.stepIndex] = (counts[call.place.stepIndex] ?? 0) + 1;
  }
  return counts;
}

async function cleanWrites(action: string): Promise<number> {
  const store = crashingStore(new MemoryRunStore(), undefined);
  const { engine } = await harness({ store });
  runOf(await engine.startAction(`notes.${action}`, { count: 1 }, { id: "clean" }));
  return store.operations.length;
}

async function crashAndResume(action: string, point: CrashPoint): Promise<void> {
  const inner = new MemoryRunStore();
  const { engine, runner, clock, freshEngine } = await harness({ store: crashingStore(inner, point) });
  await assert.rejects(engine.startAction(`notes.${action}`, { count: 1 }, { id: "crash" }), /simulated crash/);
  const afterCrash = await inner.readRun("crash");
  if (afterCrash === undefined) {
    assert.deepEqual([point.at, runner.calls.length], [1, 0]);
    return;
  }
  const unfinished = afterCrash.steps.filter((step) => step.status === "started").map((step) => step.key);
  assert.ok(unfinished.length <= 1, `at most one step can be unfinished: ${unfinished.join(", ")}`);
  clock.advance(11 * 60_000);
  const resumer = freshEngine({ store: inner });
  let result = await resumer.resume("crash");
  if (!result.ok) {
    assert.match(problemsOf(result)[0] ?? "", /has ended \(done\)/);
    assert.deepEqual((await inner.readRun("crash"))?.state, { status: "done", output: { count: 5 } });
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
}

for (const action of ["copy", "save"]) {
  test(`a crash between any two writes of the three-step ${action} action resumes on a fresh engine`, async () => {
    const writes = await cleanWrites(action);
    assert.ok(writes >= 12, `a three-step run makes at least 12 writes, saw ${String(writes)}`);
    for (let at = 1; at <= writes; at += 1) {
      for (const when of ["before", "after"] as const) {
        await crashAndResume(action, { at, when });
      }
    }
  });
}

function deferred(): PromiseWithResolvers<undefined> {
  return Promise.withResolvers<undefined>();
}

function blockingScripts(
  reached: PromiseWithResolvers<undefined>,
  held: Promise<undefined>,
): Readonly<Record<string, Script>> {
  return {
    "notes:scripts/double.ts": async (request: ScriptRequest) => {
      reached.resolve(undefined);
      await held;
      return finished({ count: 2 * (numberField(request.input, "count") ?? 0) });
    },
  };
}

test("a second writer is refused while another engine advances the run", async () => {
  const reached = deferred();
  const held = deferred();
  const { engine, freshEngine, close } = await harness({ scripts: blockingScripts(reached, held.promise) });
  const first = engine.startAction("notes.copy", { count: 1 }, { id: "busy" });
  await reached.promise;
  const second = freshEngine();
  assert.match(problemsOf(await second.resume("busy"))[0] ?? "", /being advanced by engine-1/);
  assert.match(problemsOf(await second.stop("busy"))[0] ?? "", /only one writer may advance a run/);
  assert.match(problemsOf(await engine.resume("busy"))[0] ?? "", /being advanced by engine-1/);
  held.resolve(undefined);
  assert.equal(runOf(await first).state.status, "done");
  assert.match(problemsOf(await second.resume("busy"))[0] ?? "", /has ended/);
  close();
});

test("two engines on two SQLite connections to one kernel.db: the second writer is refused", async () => {
  const folder = mkdtempSync(join(tmpdir(), "agentbay-writers-"));
  const file = join(folder, ".agentbay", "kernel.db");
  mkdirSync(join(folder, ".agentbay"));
  const firstStore = new SqliteRunStore(file);
  const secondStore = new SqliteRunStore(file);
  const reached = deferred();
  const held = deferred();
  const scripts = blockingScripts(reached, held.promise);
  const { engine, freshEngine } = await harness({ scripts, store: firstStore });
  const first = engine.startAction("notes.copy", { count: 1 }, { id: "busy" });
  await reached.promise;
  const second = freshEngine({ store: secondStore });
  assert.match(problemsOf(await second.resume("busy"))[0] ?? "", /being advanced by engine-1/);
  held.resolve(undefined);
  assert.equal(runOf(await first).state.status, "done");
  assert.deepEqual((await secondStore.readRun("busy"))?.state.status, "done");
  firstStore.close();
  secondStore.close();
  rmSync(folder, { recursive: true, force: true });
});

test("a lock left by a dead engine is taken over after ten minutes, and the takeover is an event", async () => {
  const writes = crashingStore(new MemoryRunStore(), undefined);
  const { engine: counting } = await harness({ store: writes });
  runOf(await counting.startAction("notes.save", { count: 1 }, { id: "clean" }));
  const firstOutput = writes.operations.indexOf("saveStepOutput") + 1;
  const inner = new MemoryRunStore();
  const point = { at: firstOutput, when: "before" } as const;
  const { engine, clock, freshEngine } = await harness({ store: crashingStore(inner, point) });
  await assert.rejects(engine.startAction("notes.save", { count: 1 }, { id: "dead" }), /simulated crash/);
  const resumer = freshEngine({ store: inner });
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
  const takeover = (await inner.readEvents("dead")).find((event) => event.kind === "lock.taken-over");
  assert.deepEqual(takeover?.detail, {
    previousOwner: "engine-1",
    heartbeatAt: "2026-11-14T09:00:00.000Z",
    owner: "engine-2",
  });
  const stopped = runOf(await resumer.stop("dead"));
  assert.deepEqual(stopped.state, { status: "failed", reason: "The owner stopped the run." });
});

test("one representative run emits every event kind, in order, with ids and sizes but no payloads", async () => {
  const workflows = {
    "workflows/flow.yaml": {
      name: "flow",
      steps: [
        { id: "draft", action: "draft-and-store", input: { topic: "$trigger" } },
        { id: "keep", approval: "Keep the stored draft?" },
      ],
    },
  };
  const changes = { workflows, config: { budget: { items: 1 } } };
  const { engine, store, close } = await harness({ changes });
  const id = runOf(await engine.startWorkflow({ mode: "notes", path: "workflows/flow.yaml" }, "staking")).id;
  assert.equal(
    waitingOf(await engine.submit(id, "draft/0#1", answer({ id: "d1", text: "PRIVATE-DRAFT-BODY" }))).reason,
    "budget",
  );
  const approval = waitingOf(await engine.extendBudget(id, { items: 5 }));
  assert.ok(approval.reason === "approval");
  const run = runOf(await engine.approve(id, "keep", { hash: approval.hash, decision: "reject", by: "owner" }));
  assert.equal(run.state.status, "undone");
  assert.deepEqual(await eventKinds(store, id), [
    "run.started",
    "step.started",
    "step.started",
    "run.waiting",
    "run.resumed",
    "step.finished",
    "step.started",
    "step.started",
    "step.finished",
    "budget.exceeded",
    "run.waiting",
    "run.resumed",
    "step.finished",
    "step.finished",
    "step.started",
    "run.waiting",
    "run.resumed",
    "approval.recorded",
    "step.failed",
    "undo.started",
    "step.started",
    "step.started",
    "step.finished",
    "step.finished",
    "undo.finished",
    "run.finished",
  ]);
  const events = await store.readEvents(id);
  assert.ok(!JSON.stringify(events).includes("PRIVATE-DRAFT-BODY"));
  assert.ok(!JSON.stringify(events).includes("staking"));
  const draftFinished = events.find((event) => event.kind === "step.finished");
  assert.deepEqual(draftFinished?.detail, {
    stepKey: "draft/0",
    kind: "skill",
    outputBytes: Buffer.byteLength(JSON.stringify({ id: "d1", text: "PRIVATE-DRAFT-BODY" })),
    spent: { items: 0, usd: 0, tokens: 0, minutes: 0 },
  });
  close();
});

test("a crash right after a submission is saved runs its checks on resume and refuses it a second time", async () => {
  const inner = new MemoryRunStore();
  const { engine, runner, clock, freshEngine } = await harness({ store: inner });
  const id = runOf(await engine.startAction("notes.draft", {}, { id: "draft" })).id;
  const crashing = crashingStore(inner, { at: 2, when: "after" });
  await assert.rejects(
    freshEngine({ store: crashing }).submit(id, "0#1", answer({ text: "long enough text" })),
    /simulated/,
  );
  assert.deepEqual(crashing.operations, ["acquire", "saveStepDetail"]);
  assert.deepEqual(runner.calls, []);
  clock.advance(11 * 60_000);
  const resumer = freshEngine({ store: inner });
  assert.match(
    problemsOf(await resumer.submit(id, "0#1", answer({ text: "another text" })))[0] ?? "",
    /already has a submission/,
  );
  assert.deepEqual(runOf(await resumer.resume(id)).state, { status: "done", output: { text: "long enough text" } });
  assert.equal(runner.calls.length, 1);
});

test("a crash right after a decision is saved applies it on resume and refuses a second decision", async () => {
  const inner = new MemoryRunStore();
  const workflows = {
    "workflows/flow.yaml": { name: "flow", steps: [{ id: "keep", approval: "Keep?", show: "$trigger" }] },
  };
  const { engine, clock, freshEngine } = await harness({ store: inner, changes: { workflows } });
  const waiting = waitingOf(await engine.startWorkflow({ mode: "notes", path: "workflows/flow.yaml" }, "content"));
  assert.ok(waiting.reason === "approval");
  const decision = { hash: waiting.hash, decision: "approve", by: "owner" } as const;
  const crashing = crashingStore(inner, { at: 2, when: "after" });
  await assert.rejects(freshEngine({ store: crashing }).approve("run-1", "keep", decision), /simulated/);
  clock.advance(11 * 60_000);
  const resumer = freshEngine({ store: inner });
  assert.match(problemsOf(await resumer.approve("run-1", "keep", decision))[0] ?? "", /already has a decision/);
  assert.deepEqual(runOf(await resumer.resume("run-1")).state, { status: "done", output: "content" });
  assert.ok((await eventKinds(inner, "run-1")).includes("approval.recorded"));
});

test("a live engine whose steps each take seven minutes is never taken over; a silent one is", async () => {
  let tries = 0;
  let refusedTries = 0;
  const holder: { second: Engine | undefined; silentAt: number | undefined; takeover: EngineResult | undefined } = {
    second: undefined,
    silentAt: undefined,
    takeover: undefined,
  };
  const scripts = {
    "notes:scripts/slow.ts": async (request: ScriptRequest) => {
      const silent = holder.silentAt === request.place.stepIndex;
      clock.advance((silent ? 11 : 7) * 60_000);
      const second = holder.second;
      assert.ok(second);
      if (silent) {
        holder.silentAt = undefined;
        holder.takeover = await second.resume(request.place.runId);
        return finished(request.input);
      }
      tries += 1;
      const result = await second.resume(request.place.runId);
      if (!result.ok && (result.problems[0]?.message.includes("being advanced by engine-1") ?? false)) {
        refusedTries += 1;
      }
      return finished(request.input);
    },
  };
  const { engine, clock, store, freshEngine } = await harness({ scripts });
  holder.second = freshEngine();
  assert.equal(runOf(await engine.startAction("notes.long", {}, { id: "long" })).state.status, "done");
  assert.deepEqual([tries, refusedTries], [6, 6]);
  assert.ok(!(await eventKinds(store, "long")).includes("lock.taken-over"));
  holder.silentAt = 3;
  tries = 0;
  const lost = engine.startAction("notes.long", {}, { id: "silent" });
  await assert.rejects(lost, /no longer holds the lock/);
  assert.ok(holder.takeover?.ok);
  assert.equal(holder.takeover.run.state.status, "done");
  assert.ok((await eventKinds(store, "silent")).includes("lock.taken-over"));
});

test("a database that stays busy is a refusal to try again, not an exception", async () => {
  const inner = new MemoryRunStore();
  const { engine } = await harness({ store: inner, changes: { config: { budget: { items: 1 } } } });
  const id = runOf(await engine.startAction("notes.spend", { measure: "items" })).id;
  const busy: RunStore = { ...crashingStore(inner, undefined), acquire: () => Promise.resolve({ status: "busy" }) };
  const { freshEngine } = await harness({ store: busy });
  assert.deepEqual(problemsOf(await freshEngine().extendBudget(id, { items: 5 })), [
    `Another engine is writing run ${id}; try again.`,
  ]);
});
