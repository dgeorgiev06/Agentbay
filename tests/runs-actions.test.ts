import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { measures, type ScriptRequest } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import {
  answer,
  eventKinds,
  failure,
  finished,
  fixtureRefusal,
  messagesOf,
  openedRuns,
  problemsOf,
  runOf,
  spentAt,
  startTime,
  tokenOf,
  waitingOf,
  waitingTask,
} from "./runs-fixture.ts";
import { grantsWith } from "./grants-fixture.ts";

const storeGrants = grantsWith({
  mode: "store",
  modeFolder: "/kit/components/base/store",
  databaseFile: "/kit/.agentbay/data/store.db",
  migrationsFolder: "/kit/components/base/store/migrations",
  readPaths: ["/kit/components/base/store"],
});

const notesGrants = grantsWith({
  mode: "notes",
  modeFolder: "/kit/components/modes/notes",
  databaseFile: "/kit/.agentbay/data/notes.db",
  migrationsFolder: "/kit/components/modes/notes/migrations",
  readPaths: ["/kit/components/modes/notes"],
  secrets: ["NOTES_TOKEN"],
});

const draftAction = { action: "notes.draft" };

describe("actions", () => {
  test("an action runs its steps as a pipeline and saves every step's input and output", async () => {
    const { runs, runner, close } = await openedRuns();
    const run = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
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
    const { runs, runner, close } = await openedRuns();
    const problems = problemsOf(await runs.start({ action: "notes.copy" }, { count: "one" }));
    assert.deepEqual(problems, ['input.count must be a whole number, but it is "one".']);
    assert.deepEqual(await runs.list(), []);
    assert.deepEqual(runner.calls, []);
    assert.match(messagesOf(await runs.start({ action: "notes.nothing" }, {})), /has no action nothing/);
    assert.match(messagesOf(await runs.start({ action: "ghost.copy" }, {})), /no mode ghost/);
    close();
  });

  test("output that breaks the action's output schema fails the run", async () => {
    const { runs, close } = await openedRuns();
    const run = runOf(await runs.start({ action: "notes.broken" }, {}));
    assert.equal(run.state.status, "failed");
    assert.match(run.state.reason, /output of action broken of mode notes does not match its schema/);
    assert.match(run.state.reason, /output\.count must be a whole number/);
    close();
  });

  test("a call step runs the bound mode's action with the callee's permissions and settings", async () => {
    const { runs, runner, close } = await openedRuns();
    const run = runOf(await runs.start({ action: "notes.store-one" }, { id: "n1" }));
    assert.deepEqual(run.state, { status: "done", output: { id: "n1" } });
    const [put] = runner.calls;
    assert.ok(put);
    assert.deepEqual(put.place, { runId: run.id, mode: "store", action: "put", stepKey: "0/0" });
    assert.deepEqual(put.permissions, { grants: storeGrants, actionEffects: ["write"] });
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

  test("a called action with an effect the caller lacks cannot be loaded, so no run makes the call", async () => {
    const get: Action = {
      description: "When a test runs scripts.",
      effects: ["read", "write"],
      run: [{ script: "scripts/get.ts" }],
    };
    assert.deepEqual(await fixtureRefusal({ storeActions: { get } }), [
      "Action get of mode store has the effect write, which items-store@1 does not allow for get.",
    ]);
  });

  test("nested calls draw from the caller's remaining budget", async () => {
    const { runs, runner, close } = await openedRuns();
    const run = runOf(await runs.start({ action: "notes.budgeted" }, { id: "b1", measure: "items" }));
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

  test("the smallest of the action's budget and the project default applies per measure, in nested calls too", async () => {
    const { runs, runner, close } = await openedRuns({ changes: { config: { budget: { items: 2, tokens: 100 } } } });
    const waiting = waitingOf(await runs.start({ action: "notes.budgeted" }, { id: "b1", measure: "items" }));
    assert.deepEqual(waiting, {
      reason: "budget",
      stepKey: "1/end",
      overrun: { measure: "items", limit: 1, spent: 2 },
    });
    assert.deepEqual(
      runner.calls.map((call) => [call.place.mode, call.remaining]),
      [
        ["notes", { items: 2, tokens: 100 }],
        ["store", { items: 1, tokens: 100 }],
      ],
    );
    close();
  });

  for (const measure of measures) {
    test(`exceeding ${measure} waits, extending continues, and too small an extension waits again`, async () => {
      const changes = { config: { budget: { [measure]: 1 } } };
      const { runs, runner, close } = await openedRuns({ changes });
      const started = await runs.start({ action: "notes.spend" }, { measure });
      const id = runOf(started).id;
      assert.deepEqual(waitingOf(started), {
        reason: "budget",
        stepKey: "2",
        overrun: { measure, limit: 1, spent: 2 },
      });
      assert.equal(runner.calls.length, 2);
      assert.equal(waitingOf(await runs.extend(id, { [measure]: 0 })).reason, "budget");
      assert.equal(runner.calls.length, 2);
      const afterLast = waitingOf(await runs.extend(id, { [measure]: 1 }));
      assert.deepEqual(afterLast, { reason: "budget", stepKey: "end", overrun: { measure, limit: 2, spent: 3 } });
      assert.equal(runner.calls.length, 3);
      const done = runOf(await runs.extend(id, { [measure]: 1 }));
      assert.deepEqual(done.state, { status: "done", output: { measure } });
      assert.equal(done.spent[measure], 3);
      assert.equal(runner.calls.length, 3);
      assert.equal(eventKinds(done).filter((kind) => kind === "budget.exceeded").length, 3);
      close();
    });
  }

  test("an extension raises only the measures the run limits", async () => {
    const { runs, runner, close } = await openedRuns({ changes: { config: { budget: { items: 1 } } } });
    const id = runOf(await runs.start({ action: "notes.spend" }, { measure: "items" })).id;
    runOf(await runs.extend(id, { items: 1, usd: 9 }));
    assert.deepEqual(
      runner.calls.map((call) => call.remaining),
      [{ items: 1 }, { items: 0 }, { items: 0 }],
    );
    close();
  });

  test("an extension must be numbers of at least zero, and stop ends a run that waits for budget", async () => {
    const { runs, close } = await openedRuns({ changes: { config: { budget: { usd: 1 } } } });
    const id = runOf(await runs.start({ action: "notes.spend" }, { measure: "usd" })).id;
    assert.deepEqual(problemsOf(await runs.extend(id, { usd: -1, minutes: Number.NaN })), [
      "The extension is not valid: usd must be a number of at least 0, but it is -1. " +
        "minutes must be a number of at least 0, but it is NaN.",
    ]);
    const stopped = runOf(await runs.stop(id));
    assert.deepEqual(stopped.state, { status: "failed", reason: "The owner stopped the run." });
    assert.match(messagesOf(await runs.extend(id, { usd: 5 })), /has ended \(failed\)/);
    close();
  });

  test("an extension also raises the own budget of an action the run calls", async () => {
    const scripts = { "store:scripts/put.ts": (request: ScriptRequest) => finished(request.input, { items: 11 }) };
    const { runs, close } = await openedRuns({ scripts });
    const started = await runs.start({ action: "notes.store-one" }, { id: "a" });
    assert.deepEqual(waitingOf(started), {
      reason: "budget",
      stepKey: "0/end",
      overrun: { measure: "items", limit: 10, spent: 11 },
    });
    const extended = runOf(await runs.extend(runOf(started).id, { items: 5 }));
    assert.deepEqual(extended.state, { status: "done", output: { id: "a" } });
    close();
  });

  test("a skill step waits with its task, and the submitted output continues the run", async () => {
    const { runs, close } = await openedRuns();
    const started = runOf(await runs.start({ action: "notes.draft-and-store" }, { topic: "staking" }));
    const { token, ...task } = waitingTask(started);
    assert.equal(typeof token, "string");
    assert.deepEqual(task, {
      runId: started.id,
      stepKey: "0#1",
      round: 1,
      feedback: [],
      skill: "skills/draft",
      tier: "fast",
      input: { topic: "staking" },
      files: {
        skill: "/kit/components/modes/notes/skills/draft/SKILL.md",
        outputSchema: "/kit/components/modes/notes/schemas/draft.json",
        alsoMatches: [],
      },
      place: { runId: started.id, mode: "notes", action: "draft-and-store", stepKey: "0" },
      permissions: { grants: notesGrants, actionEffects: ["read", "write"] },
      toolCalls: 0,
    });
    const run = runOf(await runs.submit(tokenOf(started), answer({ id: "d1", text: "a draft" })));
    assert.deepEqual(run.state, { status: "done", output: { id: "d1" } });
    const again = await runs.submit(tokenOf(started), answer({ id: "d1", text: "again" }));
    assert.match(messagesOf(again), /no longer waiting for it \(the run is done\)/);
    close();
  });

  test("a submission that breaks the skill's output schema is refused and the round stays open", async () => {
    const { runs, close } = await openedRuns();
    const started = runOf(await runs.start({ action: "notes.draft-and-store" }, {}));
    const problems = problemsOf(await runs.submit(tokenOf(started), answer({ id: "d1", text: "" })));
    assert.deepEqual(problems, ["output.text must not be empty."]);
    const shown = runOf(await runs.show(started.id));
    assert.ok(shown.state.status === "waiting" && shown.state.waiting.stepKey === "0#1");
    const fine = runOf(await runs.submit(tokenOf(started), answer({ id: "d1", text: "fine" })));
    assert.equal(fine.state.status, "done");
    close();
  });

  test("a last skill step shows the agent every schema its output is checked against", async () => {
    const finale = {
      description: "When a test ends with a skill.",
      input: "schemas/anything.json",
      output: "schemas/item.json",
      effects: ["read" as const],
      run: [{ skill: "skills/draft", tier: "fast" as const }],
    };
    const { runs, close } = await openedRuns({ changes: { notesActions: { finale } } });
    const started = runOf(await runs.start({ action: "notes.finale" }, {}));
    assert.deepEqual(waitingTask(started).files, {
      skill: "/kit/components/modes/notes/skills/draft/SKILL.md",
      outputSchema: "/kit/components/modes/notes/schemas/draft.json",
      alsoMatches: ["/kit/components/modes/notes/schemas/item.json"],
    });
    const onlyTheFirst = problemsOf(await runs.submit(tokenOf(started), answer({ text: "a draft" })));
    assert.ok(onlyTheFirst.length > 0);
    const both = runOf(await runs.submit(tokenOf(started), answer({ id: "d1", text: "a draft" })));
    assert.deepEqual(both.state, { status: "done", output: { id: "d1", text: "a draft" } });
    close();
  });

  test("a token of an earlier round or a made-up token is refused and changes nothing", async () => {
    const { runs, runner, close } = await openedRuns();
    const started = runOf(await runs.start(draftAction, {}));
    const second = runOf(await runs.submit(tokenOf(started), answer({ text: "short" })));
    const callsBefore = runner.calls.length;
    const before = runOf(await runs.show(started.id));
    const earlier = await runs.submit(tokenOf(started), answer({ text: "long enough text" }));
    assert.match(messagesOf(earlier), /The token is not valid: it was never issued, or a newer token/);
    const madeUp = await runs.submit("made-up", answer({ text: "long enough text" }));
    assert.match(messagesOf(madeUp), /The token is not valid/);
    assert.deepEqual(runOf(await runs.show(started.id)), before);
    assert.equal(runner.calls.length, callsBefore);
    assert.equal(waitingTask(second).stepKey, "0#2");
    close();
  });

  test("a failed check sends the skill back with feedback, and a passing round 2 finishes it", async () => {
    const { runs, runner, close } = await openedRuns();
    const started = runOf(await runs.start(draftAction, { topic: "staking" }));
    const second = runOf(await runs.submit(tokenOf(started), answer({ text: "short" })));
    const task = waitingTask(second);
    assert.equal(task.stepKey, "0#2");
    assert.equal(task.round, 2);
    assert.deepEqual(task.feedback, ["too short: short"]);
    assert.deepEqual(task.input, { topic: "staking" });
    assert.match(messagesOf(await runs.submit(tokenOf(started), answer({ text: "short" }))), /token is not valid/);
    const run = runOf(await runs.submit(tokenOf(second), answer({ text: "long enough now" })));
    assert.deepEqual(run.state, { status: "done", output: { text: "long enough now" } });
    assert.deepEqual(
      run.steps.map((step) => [step.key, step.kind, step.status]),
      [
        ["0", "skill", "done"],
        ["0#1.check0", "check", "done"],
        ["0#2.check0", "check", "done"],
      ],
    );
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
    const { runs, close } = await openedRuns();
    const started = runOf(await runs.start(draftAction, {}));
    const second = runOf(await runs.submit(tokenOf(started), answer({ text: "one" })));
    const third = runOf(await runs.submit(tokenOf(second), answer({ text: "two" })));
    assert.equal(waitingTask(third).stepKey, "0#3");
    const run = runOf(await runs.submit(tokenOf(third), answer({ text: "three" })));
    assert.equal(run.state.status, "failed");
    assert.match(run.state.reason, /failed its checks in round 3, the last round: too short: three/);
    close();
  });

  for (const verdict of [{ verdict: "fine" }, { passed: false }]) {
    test(`a check that answers ${JSON.stringify(verdict)} fails the run instead of looping`, async () => {
      const scripts = { "notes:scripts/long-enough.ts": () => finished(verdict) };
      const { runs, close } = await openedRuns({ scripts });
      const started = runOf(await runs.start(draftAction, {}));
      const run = runOf(await runs.submit(tokenOf(started), answer({ text: "anything at all" })));
      assert.ok(run.state.status === "failed");
      assert.equal(
        run.state.reason,
        'The check scripts/long-enough.ts returned neither { "passed": true } nor { "passed": false, "feedback": "..." }.',
      );
      close();
    });
  }

  test("a failed script step fails the run with its reason", async () => {
    const scripts = { "notes:scripts/double.ts": () => failure("cannot double") };
    const { runs, runner, close } = await openedRuns({ scripts });
    const run = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
    assert.deepEqual(run.state, { status: "failed", reason: "cannot double" });
    assert.equal(runner.calls.length, 2);
    close();
  });
});

test("a script may call an action through its context, and that call is saved like a step", async () => {
  const scripts = {
    "notes:scripts/log.ts": async (request: ScriptRequest) => {
      const stored = await request.call("items-store.put", { id: "from-script" });
      const refused = await request.call("items-store.erase", { id: "x" });
      return finished({ stored, refused: refused.status });
    },
  };
  const { runs, close } = await openedRuns({ scripts });
  const run = runOf(await runs.start({ action: "notes.log" }, {}));
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
  const { runs, close } = await openedRuns();
  const run = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
  assert.ok(run.events.length > 0);
  assert.deepEqual(new Set(run.events.map((event) => event.at)), new Set([startTime.toISOString()]));
  close();
});

test("a skill's reported spend is charged; over the budget, the run waits right after the skill", async () => {
  const { runs, runner, close } = await openedRuns({ changes: { config: { budget: { tokens: 100 } } } });
  const started = runOf(await runs.start({ action: "notes.draft-and-store" }, {}));
  const submitted = await runs.submit(tokenOf(started), answer({ id: "d1", text: "draft" }, { tokens: 150 }));
  assert.deepEqual(waitingOf(submitted), {
    reason: "budget",
    stepKey: "1",
    overrun: { measure: "tokens", limit: 100, spent: 150 },
  });
  assert.deepEqual(runner.calls, []);
  const run = runOf(await runs.extend(started.id, { tokens: 100 }));
  assert.equal(run.state.status, "done");
  assert.equal(run.spent.tokens, 150);
  close();
});

test("the spend of every round of a skill counts, and a negative spend is refused", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start(draftAction, {}));
  const negative = await runs.submit(tokenOf(started), answer({ text: "x" }, { usd: -1 }));
  assert.match(messagesOf(negative), /The submission's spend is not valid: usd must be a number of at least 0/);
  const second = runOf(await runs.submit(tokenOf(started), answer({ text: "short" }, { tokens: 10 })));
  const run = runOf(await runs.submit(tokenOf(second), answer({ text: "long enough now" }, { tokens: 20 })));
  assert.equal(run.state.status, "done");
  assert.equal(run.spent.tokens, 30);
  assert.equal(spentAt(run, "0").tokens, 30);
  close();
});

test("a submission that reports dollars is refused when the skill's action does not declare spend", async () => {
  const paid = {
    description: "When a test drafts for money.",
    input: "schemas/anything.json",
    output: "schemas/draft.json",
    effects: ["read", "spend"] as const,
  };
  const notesActions = { "paid-draft": { ...paid, run: [{ skill: "skills/draft", tier: "fast" as const }] } };
  const { runs, close } = await openedRuns({ changes: { notesActions } });
  const started = runOf(await runs.start(draftAction, {}));
  const refused = problemsOf(await runs.submit(tokenOf(started), answer({ text: "long enough" }, { usd: 0.5 })));
  assert.match(refused[0] ?? "", /The step 0#1 of action draft asked to report spending/);
  assert.match(refused[0] ?? "", /the action draft declares the effects: read/);
  assert.match(refused[0] ?? "", /add spend to actions\.draft\.effects in \S*components\/modes\/notes\/mode\.yaml/);
  assert.equal(runOf(await runs.show(started.id)).state.status, "waiting");
  const tokensOnly = runOf(await runs.submit(tokenOf(started), answer({ text: "long enough" }, { tokens: 40 })));
  assert.equal(tokensOnly.state.status, "done");
  assert.equal(tokensOnly.spent.tokens, 40);
  const paidRun = runOf(await runs.start({ action: "notes.paid-draft" }, {}));
  const accepted = runOf(await runs.submit(tokenOf(paidRun), answer({ text: "long enough" }, { usd: 0.5 })));
  assert.equal(accepted.state.status, "done");
  assert.equal(accepted.spent.usd, 0.5);
  close();
});

test("a script's time limit is the smaller of eight minutes and the minutes left", async () => {
  const { runs, runner, close } = await openedRuns({ changes: { config: { budget: { minutes: 3 } } } });
  runOf(await runs.start({ action: "notes.spend" }, { measure: "minutes" }));
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
  const { runs, close } = await openedRuns({ scripts });
  const run = runOf(await runs.start({ action: "notes.log" }, {}));
  assert.equal(run.spent.items, 3);
  assert.deepEqual(
    ["0", "0.call0", "0.call0/0"].map((key) => spentAt(run, key).items),
    [3, 2, 2],
  );
  close();
});
