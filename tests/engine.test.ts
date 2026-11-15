import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { measures } from "../bay/budget.ts";
import type { ScriptRequest } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import {
  eventKinds,
  failure,
  fakePolicy,
  finished,
  fixtureSystem,
  harness,
  problemsOf,
  runOf,
  startTime,
  storeKinds,
  waitingOf,
} from "./engine-fixture.ts";

for (const storeKind of storeKinds) {
  describe(`engine actions on the ${storeKind} store`, () => {
    test("an action runs its steps as a pipeline and saves every step's input and output", async () => {
      const { engine, runner, close } = await harness({ storeKind });
      const run = runOf(await engine.startAction("notes.copy", { count: 1 }));
      assert.deepEqual(run.state, { status: "done", output: { count: 5 } });
      assert.deepEqual(
        run.steps.map((step) => [step.key, step.status, step.input, step.status === "finished" ? step.output : null]),
        [
          ["0", "finished", { count: 1 }, { count: 2 }],
          ["1", "finished", { count: 2 }, { count: 4 }],
          ["2", "finished", { count: 4 }, { count: 5 }],
        ],
      );
      assert.deepEqual(
        runner.calls.map((call) => [call.place.stepIndex, call.script, call.input]),
        [
          [0, "scripts/add-one.ts", { count: 1 }],
          [1, "scripts/double.ts", { count: 2 }],
          [2, "scripts/add-one.ts", { count: 4 }],
        ],
      );
      const [firstCall] = runner.calls;
      assert.ok(firstCall);
      assert.deepEqual(firstCall.place, { runId: run.id, mode: "notes", action: "copy", stepIndex: 0 });
      assert.deepEqual(firstCall.settings, { greeting: "hello" });
      close();
    });

    test("input that breaks the action's input schema is refused before any run exists", async () => {
      const { engine, store, runner, close } = await harness({ storeKind });
      const problems = problemsOf(await engine.startAction("notes.copy", { count: "one" }));
      assert.deepEqual(problems, ['input.count must be a whole number, but it is "one".']);
      assert.equal(await store.readRun("run-1"), undefined);
      assert.deepEqual(runner.calls, []);
      assert.match(problemsOf(await engine.startAction("notes.nothing", {}))[0] ?? "", /has no action nothing/);
      assert.match(problemsOf(await engine.startAction("ghost.copy", {}))[0] ?? "", /no mode ghost/);
      close();
    });

    test("output that breaks the action's output schema fails the run", async () => {
      const { engine, close } = await harness({ storeKind });
      const run = runOf(await engine.startAction("notes.broken", {}));
      assert.equal(run.state.status, "failed");
      assert.match(run.state.reason, /output of action broken of mode notes does not match its schema/);
      assert.match(run.state.reason, /output\.count must be a whole number/);
      close();
    });

    test("a call step runs the bound mode's action with the callee's permissions and settings", async () => {
      const { engine, runner, close } = await harness({ storeKind });
      const run = runOf(await engine.startAction("notes.store-one", { id: "n1" }));
      assert.deepEqual(run.state, { status: "done", output: { id: "n1" } });
      const [put] = runner.calls;
      assert.ok(put);
      assert.deepEqual(put.place, { runId: run.id, mode: "store", action: "put", stepIndex: 0 });
      assert.deepEqual(put.permissions, fakePolicy("store"));
      assert.deepEqual(put.settings, {});
      assert.deepEqual(
        run.steps.map((step) => [step.key, step.kind, step.status]),
        [
          ["0", "call", "finished"],
          ["0/0", "script", "finished"],
        ],
      );
      close();
    });

    test("a call to an action with an effect the caller lacks is refused at run time, before it runs", async () => {
      const { system } = await fixtureSystem();
      const store = system.modes.get("store");
      assert.ok(store);
      const original = store.manifest.actions.get;
      assert.ok(original);
      const get: Action = { ...original, effects: ["read", "write"] };
      const changedStore = { ...store, manifest: { ...store.manifest, actions: { ...store.manifest.actions, get } } };
      const changed = { ...system, modes: new Map([...system.modes, ["store", changedStore]]) };
      const { freshEngine, runner, close } = await harness({ storeKind });
      const run = runOf(await freshEngine({ system: changed }).startAction("notes.peek", {}));
      assert.equal(run.state.status, "failed");
      assert.equal(
        run.state.reason,
        "The action peek of mode notes calls items-store.get, which has the effects write that peek does not " +
          "declare; the call is refused.",
      );
      assert.deepEqual(runner.calls, []);
      close();
    });

    test("nested calls draw from the caller's remaining budget", async () => {
      const { engine, runner, close } = await harness({ storeKind });
      const run = runOf(await engine.startAction("notes.budgeted", { id: "b1", measure: "items" }));
      assert.equal(run.state.status, "done");
      assert.deepEqual(
        runner.calls.map((call) => [call.place.mode, call.remaining]),
        [
          ["notes", { items: 5 }],
          ["store", { items: 4 }],
          ["notes", { items: 2 }],
        ],
      );
      assert.deepEqual(run.spent, { items: 4, usd: 0, tokens: 0, minutes: 0 });
      close();
    });

    test("the smallest of the action's budget and the project default applies, in nested calls too", async () => {
      const { engine, runner, close } = await harness({ storeKind, changes: { config: { budget: { items: 2 } } } });
      const waiting = waitingOf(await engine.startAction("notes.budgeted", { id: "b1", measure: "items" }));
      assert.deepEqual(waiting, {
        reason: "budget",
        stepKey: "1/end",
        overrun: { measure: "items", limit: 1, spent: 2 },
      });
      assert.deepEqual(
        runner.calls.map((call) => [call.place.mode, call.remaining]),
        [
          ["notes", { items: 2 }],
          ["store", { items: 1 }],
        ],
      );
      close();
    });

    for (const measure of measures) {
      test(`exceeding ${measure} waits, extending continues, and too small an extension waits again`, async () => {
        const changes = { config: { budget: { [measure]: 1 } } };
        const { engine, store, runner, close } = await harness({ storeKind, changes });
        const started = await engine.startAction("notes.spend", { measure });
        const id = runOf(started).id;
        assert.deepEqual(waitingOf(started), {
          reason: "budget",
          stepKey: "2",
          overrun: { measure, limit: 1, spent: 2 },
        });
        assert.equal(runner.calls.length, 2);
        assert.equal(waitingOf(await engine.extendBudget(id, { [measure]: 0 })).reason, "budget");
        assert.equal(runner.calls.length, 2);
        const afterLast = waitingOf(await engine.extendBudget(id, { [measure]: 1 }));
        assert.deepEqual(afterLast, { reason: "budget", stepKey: "end", overrun: { measure, limit: 2, spent: 3 } });
        assert.equal(runner.calls.length, 3);
        const done = runOf(await engine.extendBudget(id, { [measure]: 1 }));
        assert.deepEqual(done.state, { status: "done", output: { measure } });
        assert.equal(done.spent[measure], 3);
        assert.equal(runner.calls.length, 3);
        assert.equal((await eventKinds(store, id)).filter((kind) => kind === "budget.exceeded").length, 3);
        close();
      });
    }

    test("an extension must not be negative, and stop ends a run that waits for budget", async () => {
      const { engine, close } = await harness({ storeKind, changes: { config: { budget: { usd: 1 } } } });
      const id = runOf(await engine.startAction("notes.spend", { measure: "usd" })).id;
      assert.match(
        problemsOf(await engine.extendBudget(id, { usd: -1 }))[0] ?? "",
        /usd must be a number of at least 0/,
      );
      const stopped = runOf(await engine.stop(id));
      assert.deepEqual(stopped.state, { status: "failed", reason: "The owner stopped the run." });
      assert.match(problemsOf(await engine.extendBudget(id, { usd: 5 }))[0] ?? "", /has ended \(failed\)/);
      close();
    });

    test("a skill step waits with its task, and the submitted output continues the run", async () => {
      const { engine, close } = await harness({ storeKind });
      const started = await engine.startAction("notes.draft-and-store", { topic: "staking" });
      const id = runOf(started).id;
      const waiting = waitingOf(started);
      assert.deepEqual(waiting, {
        reason: "skill",
        stepKey: "0#1",
        task: {
          place: { runId: id, mode: "notes", action: "draft-and-store", stepIndex: 0 },
          skill: "skills/draft",
          tier: "fast",
          input: { topic: "staking" },
          outputSchema: "schemas/draft.json",
          permissions: fakePolicy("notes"),
          round: 1,
          feedback: [],
        },
      });
      const run = runOf(await engine.submit(id, "0#1", { id: "d1", text: "a draft" }));
      assert.deepEqual(run.state, { status: "done", output: { id: "d1" } });
      assert.match(problemsOf(await engine.submit(id, "0#1", { id: "d1", text: "again" }))[0] ?? "", /has ended/);
      close();
    });

    test("a submission that breaks the skill's output schema is refused and the round stays open", async () => {
      const { engine, store, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft-and-store", {})).id;
      const problems = problemsOf(await engine.submit(id, "0#1", { id: "d1", text: "" }));
      assert.deepEqual(problems, ["output.text must not be empty."]);
      assert.deepEqual((await store.readRun(id))?.state, { status: "waiting", reason: "skill", stepKey: "0#1" });
      assert.equal(runOf(await engine.submit(id, "0#1", { id: "d1", text: "fine" })).state.status, "done");
      close();
    });

    test("a submission for another step or round is refused and changes nothing", async () => {
      const { engine, store, runner, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft", {})).id;
      const before = await store.readRun(id);
      for (const key of ["1#1", "0#2", "0", "#1"]) {
        assert.match(problemsOf(await engine.submit(id, key, { text: "long enough text" }))[0] ?? "", /not waiting/);
      }
      assert.deepEqual(await store.readRun(id), before);
      assert.deepEqual(runner.calls, []);
      assert.match(problemsOf(await engine.submit("nobody", "0#1", {}))[0] ?? "", /There is no run nobody/);
      close();
    });

    test("a failed check sends the skill back with feedback, and a passing round 2 finishes it", async () => {
      const { engine, runner, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft", { topic: "staking" })).id;
      const second = waitingOf(await engine.submit(id, "0#1", { text: "short" }));
      assert.equal(second.reason, "skill");
      assert.equal(second.stepKey, "0#2");
      assert.equal(second.task.round, 2);
      assert.deepEqual(second.task.feedback, ["too short: short"]);
      assert.deepEqual(second.task.input, { topic: "staking" });
      assert.match(problemsOf(await engine.submit(id, "0#1", { text: "short" }))[0] ?? "", /not waiting/);
      const run = runOf(await engine.submit(id, "0#2", { text: "long enough now" }));
      assert.deepEqual(run.state, { status: "done", output: { text: "long enough now" } });
      assert.deepEqual(
        runner.calls.map((call) => [call.script, call.input]),
        [
          ["scripts/long-enough.ts", { text: "short" }],
          ["scripts/long-enough.ts", { text: "long enough now" }],
        ],
      );
      close();
    });

    test("a check that still fails in round 3 fails the run", async () => {
      const { engine, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft", {})).id;
      waitingOf(await engine.submit(id, "0#1", { text: "one" }));
      const third = waitingOf(await engine.submit(id, "0#2", { text: "two" }));
      assert.equal(third.stepKey, "0#3");
      const run = runOf(await engine.submit(id, "0#3", { text: "three" }));
      assert.equal(run.state.status, "failed");
      assert.match(run.state.reason, /failed its checks in round 3, the last round: too short: three/);
      close();
    });

    test("a check that does not answer passed or feedback fails the run instead of looping", async () => {
      const scripts = { "notes:scripts/long-enough.ts": () => finished({ verdict: "fine" }) };
      const { engine, close } = await harness({ storeKind, scripts });
      const id = runOf(await engine.startAction("notes.draft", {})).id;
      const run = runOf(await engine.submit(id, "0#1", { text: "anything at all" }));
      assert.ok(run.state.status === "failed");
      assert.match(run.state.reason, /returned neither/);
      close();
    });

    test("a failed script step fails the run with its reason", async () => {
      const scripts = { "notes:scripts/double.ts": () => failure("cannot double") };
      const { engine, runner, close } = await harness({ storeKind, scripts });
      const run = runOf(await engine.startAction("notes.copy", { count: 1 }));
      assert.deepEqual(run.state, { status: "failed", reason: "cannot double" });
      assert.equal(runner.calls.length, 2);
      close();
    });
  });
}

test("a script may call an action through its context, and that call is saved like a step", async () => {
  const scripts = {
    "notes:scripts/log.ts": async (request: ScriptRequest) => {
      const stored = await request.call("items-store.put", { id: "from-script" });
      const refused = await request.call("items-store.erase", { id: "x" });
      return finished({ stored, refused: refused.status });
    },
  };
  const { engine, close } = await harness({ scripts });
  const run = runOf(await engine.startAction("notes.log", {}));
  assert.equal(run.state.status, "done");
  assert.deepEqual(run.state.output, {
    stored: { status: "done", output: { id: "from-script" }, spent: { items: 2, usd: 0, tokens: 0, minutes: 0 } },
    refused: "failed",
  });
  assert.deepEqual(
    run.steps.map((step) => [step.key, step.kind, step.status]),
    [
      ["0", "script", "finished"],
      ["0.call0", "call", "finished"],
      ["0.call0/0", "script", "finished"],
      ["0.call1", "call", "failed"],
    ],
  );
  close();
});

test("the run's clock time is when its events happen", async () => {
  const { engine, store, close } = await harness();
  const id = runOf(await engine.startAction("notes.copy", { count: 1 })).id;
  const events = await store.readEvents(id);
  assert.ok(events.every((event) => event.at === startTime.toISOString()));
  close();
});
