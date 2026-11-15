import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import {
  answer,
  crashingOnce,
  failure,
  finished,
  messagesOf,
  openedRuns,
  runOf,
  tokenOf,
  waitingOf,
} from "./runs-fixture.ts";

function callersOf(requests: readonly ScriptRequest[]): readonly (string | undefined)[] {
  return requests.map((request) => request.caller);
}

test("an action reached by a call step sees the calling mode as its caller", async () => {
  const { runs, runner, close } = await openedRuns();
  const run = runOf(await runs.start({ action: "notes.store-one" }, { id: "a" }));
  assert.equal(run.state.status, "done");
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/put.ts")), ["notes"]);
  close();
});

test("an action started directly sees no caller", async () => {
  const { runs, runner, close } = await openedRuns();
  runOf(await runs.start({ action: "store.put" }, { id: "a" }));
  runOf(await runs.start({ action: "notes.log" }, {}));
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
  const { runs, runner, close } = await openedRuns({ scripts });
  runOf(await runs.start({ action: "notes.log" }, {}));
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
  const changes = { workflows: { "workflows/both.yaml": workflow } };
  const { runs, runner, close } = await openedRuns({ changes });
  const run = runOf(await runs.start({ workflow: { mode: "notes", path: "workflows/both.yaml" } }, {}));
  assert.equal(run.state.status, "done");
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/put.ts")), ["notes"]);
  assert.deepEqual(callersOf(runner.runsOf("notes:scripts/log.ts")), [undefined]);
  close();
});

test("the undo of a called action runs with the same caller as the action", async () => {
  const { runs, runner, close } = await openedRuns();
  const run = runOf(await runs.start({ action: "notes.store-then-fail" }, { id: "u" }));
  assert.equal(run.state.status, "undone");
  assert.deepEqual(callersOf(runner.runsOf("store:scripts/remove.ts")), ["notes"]);
  close();
});

test("a run started for a skill keeps its caller, and a later openRuns that resumes it still passes it on", async () => {
  const scripts = {
    "store:scripts/get.ts": crashingOnce((request) => finished({ caller: request.caller ?? null })),
  };
  const { runs, reopen, close } = await openedRuns({ scripts });
  const parent = runOf(await runs.start({ action: "notes.draft" }, {}));
  const called = await runs.callAction(tokenOf(parent), "items-store.get", {});
  assert.match(messagesOf(called), /stopped at an unexpected error: the process died/);
  const child = (await runs.list()).find((run) => run.target.mode === "store");
  assert.ok(child);
  assert.equal(child.status, "running");
  const later = await reopen();
  const resumed = runOf(await later.resume(child.id));
  assert.deepEqual(resumed.state, { status: "done", output: { caller: "notes" } });
  close();
});

test("a check sees the skill's input and no caller of a run started directly; another script sees no skill input", async () => {
  const { runs, runner, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, { topic: "rain" }));
  const done = runOf(await runs.submit(tokenOf(started), answer({ text: "a long enough draft" })));
  assert.equal(done.state.status, "done");
  const checks = runner.runsOf("notes:scripts/long-enough.ts");
  assert.deepEqual(callersOf(checks), [undefined]);
  assert.deepEqual(checks[0]?.skillInput, { topic: "rain" });
  runOf(await runs.start({ action: "notes.log" }, {}));
  const logs = runner.runsOf("notes:scripts/log.ts");
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.skillInput, undefined);
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
  const { runs, runner, close } = await openedRuns({ scripts, changes: { config: { budget: { items: 3 } } } });
  const started = await runs.start({ action: "notes.log" }, {});
  const waiting = waitingOf(started);
  assert.equal(waiting.reason, "budget");
  assert.equal(waiting.stepKey, "0.call1/end");
  assert.equal(runner.runsOf("store:scripts/put.ts").length, 2);
  const run = runOf(await runs.extend(runOf(started).id, { items: 5 }));
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
  const { runs, runner, close } = await openedRuns({ scripts, changes: { config: { budget: { items: 3 } } } });
  const started = await runs.start({ action: "notes.log" }, {});
  assert.equal(waitingOf(started).reason, "budget");
  const stopped = runOf(await runs.stop(runOf(started).id));
  assert.deepEqual(stopped.state, {
    status: "undone",
    reason: "The owner stopped the run.",
    undo: {
      undone: [{ stepKey: "0.call0", action: "store.put" }],
      failed: [],
      noUndo: [],
      deleteNotUndone: [],
    },
  });
  assert.equal(runner.runsOf("notes:scripts/log.ts").length, 1);
  close();
});
