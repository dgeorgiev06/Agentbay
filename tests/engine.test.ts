import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { measures } from "../bay/runs/budget.ts";
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
  answer,
} from "./engine-fixture.ts";

for (const storeKind of storeKinds) {
  describe(`engine actions on the ${storeKind} store`, () => {
    test("an action runs its steps as a pipeline and saves every step's input and output", async () => {
      const { engine, runner, close } = await harness({ storeKind });
      const run = runOf(await engine.startAction("notes.copy", { count: 1 }));
      assert.deepEqual(run.state, { status: "done", output: { count: 5 } });
      assert.deepEqual(
        run.steps.map((step) => [step.key, step.status, step.input, step.status === "done" ? step.output : null]),
        [
          ["0", "done", { count: 1 }, { count: 2 }],
          ["1", "done", { count: 2 }, { count: 4 }],
          ["2", "done", { count: 4 }, { count: 5 }],
        ],
      );
      assert.deepEqual(
        runner.calls.map((call) => [Number(call.place.stepKey), call.script, call.input]),
        [
          [0, "scripts/add-one.ts", { count: 1 }],
          [1, "scripts/double.ts", { count: 2 }],
          [2, "scripts/add-one.ts", { count: 4 }],
        ],
      );
      const [firstCall] = runner.calls;
      assert.ok(firstCall);
      assert.deepEqual(firstCall.place, { runId: run.id, mode: "notes", action: "copy", stepKey: "0" });
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
      assert.deepEqual(put.place, { runId: run.id, mode: "store", action: "put", stepKey: "0/0" });
      assert.deepEqual(put.permissions, { grants: fakePolicy("store"), actionEffects: ["write"] });
      assert.equal(put.timeLimitMilliseconds, 8 * 60_000);
      assert.deepEqual(put.settings, {});
      assert.deepEqual(
        run.steps.map((step) => [step.key, step.kind, step.status]),
        [
          ["0", "call", "done"],
          ["0/0", "script", "done"],
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
          place: { runId: id, mode: "notes", action: "draft-and-store", stepKey: "0" },
          skill: "skills/draft",
          tier: "fast",
          input: { topic: "staking" },
          outputSchema: "schemas/draft.json",
          alsoMatches: [],
          permissions: { grants: fakePolicy("notes"), actionEffects: ["read", "write"] },
          round: 1,
          feedback: [],
        },
      });
      const run = runOf(await engine.submit(id, "0#1", answer({ id: "d1", text: "a draft" })));
      assert.deepEqual(run.state, { status: "done", output: { id: "d1" } });
      assert.match(
        problemsOf(await engine.submit(id, "0#1", answer({ id: "d1", text: "again" })))[0] ?? "",
        /has ended/,
      );
      close();
    });

    test("a submission that breaks the skill's output schema is refused and the round stays open", async () => {
      const { engine, store, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft-and-store", {})).id;
      const problems = problemsOf(await engine.submit(id, "0#1", answer({ id: "d1", text: "" })));
      assert.deepEqual(problems, ["output.text must not be empty."]);
      assert.deepEqual((await store.readRun(id))?.state, { status: "waiting", reason: "skill", stepKey: "0#1" });
      assert.equal(runOf(await engine.submit(id, "0#1", answer({ id: "d1", text: "fine" }))).state.status, "done");
      close();
    });

    test("a last skill step shows the agent every schema its output is checked against", async () => {
      const finale = {
        input: "schemas/anything.json",
        output: "schemas/item.json",
        effects: ["read" as const],
        run: [{ skill: "skills/draft", tier: "fast" as const }],
      };
      const { engine, close } = await harness({ storeKind, changes: { notesActions: { finale } } });
      const started = await engine.startAction("notes.finale", {});
      const waiting = waitingOf(started);
      assert.ok(waiting.reason === "skill");
      const shown = [waiting.task.outputSchema, ...waiting.task.alsoMatches];
      assert.deepEqual(shown, ["schemas/draft.json", "schemas/item.json"]);
      const id = runOf(started).id;
      const onlyTheFirst = problemsOf(await engine.submit(id, "0#1", answer({ text: "a draft" })));
      assert.ok(onlyTheFirst.length > 0);
      const both = runOf(await engine.submit(id, "0#1", answer({ id: "d1", text: "a draft" })));
      assert.deepEqual(both.state, { status: "done", output: { id: "d1", text: "a draft" } });
      close();
    });

    test("a submission for another step or round is refused and changes nothing", async () => {
      const { engine, store, runner, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft", {})).id;
      const before = await store.readRun(id);
      for (const key of ["1#1", "0#2", "0", "#1"]) {
        assert.match(
          problemsOf(await engine.submit(id, key, answer({ text: "long enough text" })))[0] ?? "",
          /not waiting/,
        );
      }
      assert.deepEqual(await store.readRun(id), before);
      assert.deepEqual(runner.calls, []);
      assert.match(problemsOf(await engine.submit("nobody", "0#1", answer({})))[0] ?? "", /There is no run nobody/);
      close();
    });

    test("a failed check sends the skill back with feedback, and a passing round 2 finishes it", async () => {
      const { engine, runner, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft", { topic: "staking" })).id;
      const second = waitingOf(await engine.submit(id, "0#1", answer({ text: "short" })));
      assert.equal(second.reason, "skill");
      assert.equal(second.stepKey, "0#2");
      assert.equal(second.task.round, 2);
      assert.deepEqual(second.task.feedback, ["too short: short"]);
      assert.deepEqual(second.task.input, { topic: "staking" });
      assert.match(problemsOf(await engine.submit(id, "0#1", answer({ text: "short" })))[0] ?? "", /not waiting/);
      const run = runOf(await engine.submit(id, "0#2", answer({ text: "long enough now" })));
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
      waitingOf(await engine.submit(id, "0#1", answer({ text: "one" })));
      const third = waitingOf(await engine.submit(id, "0#2", answer({ text: "two" })));
      assert.equal(third.stepKey, "0#3");
      const run = runOf(await engine.submit(id, "0#3", answer({ text: "three" })));
      assert.equal(run.state.status, "failed");
      assert.match(run.state.reason, /failed its checks in round 3, the last round: too short: three/);
      close();
    });

    test("a check that does not answer passed or feedback fails the run instead of looping", async () => {
      const scripts = { "notes:scripts/long-enough.ts": () => finished({ verdict: "fine" }) };
      const { engine, close } = await harness({ storeKind, scripts });
      const id = runOf(await engine.startAction("notes.draft", {})).id;
      const run = runOf(await engine.submit(id, "0#1", answer({ text: "anything at all" })));
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
      ["0", "script", "done"],
      ["0.call0", "call", "done"],
      ["0.call0/0", "script", "done"],
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

test("a skill's reported spend is charged; over the budget, the run waits right after the skill", async () => {
  const { engine, runner, close } = await harness({ changes: { config: { budget: { tokens: 100 } } } });
  const id = runOf(await engine.startAction("notes.draft-and-store", {})).id;
  const waiting = waitingOf(await engine.submit(id, "0#1", answer({ id: "d1", text: "draft" }, { tokens: 150 })));
  assert.deepEqual(waiting, { reason: "budget", stepKey: "1", overrun: { measure: "tokens", limit: 100, spent: 150 } });
  assert.deepEqual(runner.calls, []);
  const run = runOf(await engine.extendBudget(id, { tokens: 100 }));
  assert.equal(run.state.status, "done");
  assert.equal(run.spent.tokens, 150);
  const refused = await engine.submit(id, "0#1", answer({}, { usd: -1 }));
  assert.match(problemsOf(refused)[0] ?? "", /has ended/);
  close();
});

test("the spend of every round of a skill counts, and a negative spend is refused", async () => {
  const { engine, close } = await harness();
  const id = runOf(await engine.startAction("notes.draft", {})).id;
  assert.match(problemsOf(await engine.submit(id, "0#1", answer({ text: "x" }, { usd: -1 })))[0] ?? "", /not valid/);
  waitingOf(await engine.submit(id, "0#1", answer({ text: "short" }, { tokens: 10 })));
  const run = runOf(await engine.submit(id, "0#2", answer({ text: "long enough now" }, { tokens: 20 })));
  assert.equal(run.state.status, "done");
  assert.equal(run.spent.tokens, 30);
  assert.ok(run.steps[0]?.status === "done");
  assert.equal(run.steps[0].spent.tokens, 30);
  close();
});

test("a submission that reports dollars is refused when the skill's action does not declare spend", async () => {
  const paid = { input: "schemas/anything.json", output: "schemas/draft.json", effects: ["read", "spend"] as const };
  const notesActions = { "paid-draft": { ...paid, run: [{ skill: "skills/draft", tier: "fast" as const }] } };
  const { engine, store, close } = await harness({ changes: { notesActions } });
  const id = runOf(await engine.startAction("notes.draft", {})).id;
  const refused = problemsOf(await engine.submit(id, "0#1", answer({ text: "long enough" }, { usd: 0.5 })));
  assert.match(refused[0] ?? "", /The step 0#1 of action draft asked to report spending/);
  assert.match(refused[0] ?? "", /the action draft declares the effects: read/);
  assert.match(refused[0] ?? "", /add spend to actions\.draft\.effects in \S*components\/modes\/notes\/mode\.yaml/);
  assert.equal((await store.readRun(id))?.state.status, "waiting");
  const tokensOnly = runOf(await engine.submit(id, "0#1", answer({ text: "long enough" }, { tokens: 40 })));
  assert.equal(tokensOnly.state.status, "done");
  assert.equal(tokensOnly.spent.tokens, 40);
  const paidId = runOf(await engine.startAction("notes.paid-draft", {}, { id: "paid" })).id;
  const accepted = runOf(await engine.submit(paidId, "0#1", answer({ text: "long enough" }, { usd: 0.5 })));
  assert.equal(accepted.state.status, "done");
  assert.equal(accepted.spent.usd, 0.5);
  close();
});

test("a script's time limit is the smaller of eight minutes and the minutes left", async () => {
  const { engine, runner, close } = await harness({ changes: { config: { budget: { minutes: 3 } } } });
  runOf(await engine.startAction("notes.spend", { measure: "minutes" }));
  assert.deepEqual(
    runner.calls.map((call) => call.timeLimitMilliseconds),
    [180_000, 120_000, 60_000],
  );
  close();
});

test("a script that calls an action is charged once: its own spend plus the call's, from the call's records", async () => {
  const scripts = {
    "notes:scripts/log.ts": async (request: ScriptRequest) => {
      await request.call("items-store.put", { id: "inner" });
      return finished({}, { items: 1 });
    },
  };
  const { engine, close } = await harness({ scripts });
  const run = runOf(await engine.startAction("notes.log", {}));
  assert.equal(run.spent.items, 3);
  const spentOf = (key: string): number => {
    const step = run.steps.find((candidate) => candidate.key === key);
    assert.ok(step?.status === "done");
    return step.spent.items;
  };
  assert.deepEqual([spentOf("0"), spentOf("0.call0"), spentOf("0.call0/0")], [3, 2, 2]);
  close();
});
