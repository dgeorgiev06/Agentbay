import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import { answer, failure, finished, harness, runOf, waitingOf } from "./engine-fixture.ts";

function callersOf(requests: readonly ScriptRequest[]): readonly (string | undefined)[] {
  return requests.map((request) => request.caller);
}

test("an action reached by a call step sees the calling mode as its caller", async () => {
  const { engine, runner, close } = await harness();
  const run = runOf(await engine.startAction("notes.store-one", { id: "a" }));
  assert.equal(run.state.status, "done");
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/put.ts")), ["notes"]);
  close();
});

test("an action started directly sees no caller", async () => {
  const { engine, runner, close } = await harness();
  runOf(await engine.startAction("store.put", { id: "a" }));
  runOf(await engine.startAction("notes.log", {}, { id: "second" }));
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/put.ts")), [undefined]);
  assert.deepEqual(callersOf(runner.runsOf("notes:scripts/log.ts")), [undefined]);
  close();
});

test("an action a script calls through its context sees the script's mode, whatever the script sends", async () => {
  const scripts = {
    "notes:scripts/log.ts": async (request: ScriptRequest) => {
      await request.call("items-store.put", { id: "x", caller: "intruder" });
      return finished({});
    },
    "store:scripts/put.ts": () => finished({ id: "x" }, { items: 1 }),
  };
  const { engine, runner, close } = await harness({ scripts });
  runOf(await engine.startAction("notes.log", {}));
  const puts = runner.runsOf("store:scripts/put.ts");
  assert.deepEqual(callersOf(puts), ["notes"]);
  assert.deepEqual(puts[0]?.input, { id: "x", caller: "intruder" });
  close();
});

test("a workflow step that reaches an interface carries the workflow's mode; its own action carries none", async () => {
  const workflow = {
    name: "both",
    steps: [
      { id: "keep", action: "items-store.put", input: { id: "w" } },
      { id: "note", action: "log", input: {} },
    ],
  };
  const { engine, runner, close } = await harness({ changes: { workflows: { "workflows/both.yaml": workflow } } });
  const run = runOf(await engine.startWorkflow({ mode: "notes", path: "workflows/both.yaml" }, {}));
  assert.equal(run.state.status, "done");
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/put.ts")), ["notes"]);
  assert.deepEqual(callersOf(runner.runsOf("notes:scripts/log.ts")), [undefined]);
  close();
});

test("the undo of a called action runs with the same caller as the action", async () => {
  const { engine, runner, close } = await harness();
  const run = runOf(await engine.startAction("notes.store-then-fail", { id: "u" }));
  assert.equal(run.state.status, "undone");
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/remove.ts")), ["notes"]);
  close();
});

test("a run started for a caller keeps it in the store, and its later steps and checks still see it", async () => {
  const { engine, runner, store, freshEngine, close } = await harness({ storeKind: "sqlite" });
  const result = await engine.startAction("notes.draft", { topic: "rain" }, { caller: "store" });
  const started = runOf(result);
  assert.deepEqual(started.target, { kind: "action", mode: "notes", name: "draft", caller: "store" });
  const stored = (await store.readRun(started.id))?.target;
  assert.deepEqual(stored, { kind: "action", mode: "notes", name: "draft", caller: "store" });
  const waiting = waitingOf(result);
  const later = freshEngine();
  const done = runOf(await later.submit(started.id, waiting.stepKey, answer({ text: "a long enough draft" })));
  assert.equal(done.state.status, "done");
  const checks = runner.runsOf("notes:scripts/long-enough.ts");
  assert.deepEqual(callersOf(checks), ["store"]);
  assert.deepEqual(checks[0]?.skillInput, { topic: "rain" });
  assert.equal(runner.runsOf("notes:scripts/log.ts")[0]?.skillInput, undefined);
  close();
});

test("a script whose call waits for budget waits too, and on resume its finished calls are replayed", async () => {
  const scripts = {
    "notes:scripts/log.ts": async (request: ScriptRequest) => {
      const first = await request.call("items-store.put", { id: "one" });
      const second = await request.call("items-store.put", { id: "two" });
      return second.status === "done" ? finished({ first: first.status, second: second.status }) : failure("waited");
    },
  };
  const { engine, runner, close } = await harness({ scripts, changes: { config: { budget: { items: 3 } } } });
  const waiting = waitingOf(await engine.startAction("notes.log", {}));
  assert.equal(waiting.reason, "budget");
  assert.equal(waiting.stepKey, "0.call1/end");
  assert.equal(runner.runsOf("store:scripts/put.ts").length, 2);
  const id = "run-1";
  const run = runOf(await engine.extendBudget(id, { items: 5 }));
  assert.equal(run.state.status, "done");
  assert.deepEqual(run.state, { status: "done", output: { first: "done", second: "done" } });
  assert.equal(runner.runsOf("store:scripts/put.ts").length, 2);
  assert.equal(runner.runsOf("notes:scripts/log.ts").length, 2);
  assert.equal(run.spent.items, 4);
  close();
});

test("a script that ignores the failed answer of a waiting call still waits, its result set aside", async () => {
  const scripts = {
    "notes:scripts/log.ts": async (request: ScriptRequest) => {
      await request.call("items-store.put", { id: "one" });
      await request.call("items-store.put", { id: "two" });
      return finished({ pretended: true });
    },
  };
  const { engine, runner, close } = await harness({ scripts, changes: { config: { budget: { items: 3 } } } });
  const waiting = waitingOf(await engine.startAction("notes.log", {}));
  assert.equal(waiting.reason, "budget");
  const stopped = runOf(await engine.stop("run-1"));
  assert.equal(stopped.state.status, "undone");
  assert.equal(runner.runsOf("notes:scripts/log.ts").length, 1);
  close();
});
