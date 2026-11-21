import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { hashOf, textField } from "../bay/json.ts";
import {
  answer,
  eventKinds,
  failure,
  finished,
  fixtureRefusal,
  fixtureSystem,
  messagesOf,
  notesFlow,
  openedRuns,
  problemsOf,
  runOf,
  startTime,
  tokenOf,
  waitingOf,
  withFlow,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

const reviewSteps: Workflow["steps"] = [
  { id: "seed", action: "copy", input: { count: "$trigger" } },
  { id: "keep", approval: "Keep this count?", show: "$steps.seed.output" },
  { id: "after", action: "copy" },
];

const hour = 3_600_000;

describe("workflows", () => {
  test("action steps take literal and referenced input, and later steps see earlier outputs", async () => {
    const changes = withFlow([
      { id: "seed", action: "copy", input: { count: "$trigger" } },
      { id: "again", action: "copy", input: { count: "$steps.seed.output.count" } },
      { id: "keep", action: "items-store.put", input: { id: "$settings.greeting" } },
      { id: "chained", action: "copy", input: { count: 0 } },
      { id: "last", action: "log" },
    ]);
    const { runs, close } = await openedRuns({ changes });
    const run = runOf(await runs.start(flow, 1));
    assert.deepEqual(run.state, { status: "done", output: { count: 3 } });
    const inputs = Object.fromEntries(run.steps.filter((step) => !step.key.includes("/")).map((s) => [s.key, s.input]));
    assert.deepEqual(inputs, {
      seed: { count: 1 },
      again: { count: 5 },
      keep: { id: "hello" },
      chained: { count: 0 },
      last: { count: 3 },
    });
    close();
  });

  test("a reference that resolves to nothing fails the step and names what was there", async () => {
    const changes = withFlow([
      { id: "seed", action: "copy", input: { count: "$trigger" } },
      { id: "again", action: "copy", input: { count: "$steps.seed.output.total" } },
    ]);
    const { runs, runner, close } = await openedRuns({ changes });
    const run = runOf(await runs.start(flow, 1));
    assert.equal(run.state.status, "failed");
    assert.equal(
      run.state.reason,
      "Step again cannot start: input.count: $steps.seed.output.total resolves to nothing: output of step seed " +
        "has no total; it is a mapping with the keys count.",
    );
    assert.equal(runner.calls.length, 3);
    close();
  });

  test("foreach runs its steps once per element, in order, saved under the element's index", async () => {
    const changes = withFlow([
      {
        id: "each",
        foreach: "$trigger",
        steps: [
          { id: "put", action: "items-store.put", input: { id: "$item" } },
          { id: "echo", action: "log", input: { stored: "$steps.put.output.id", first: "$trigger" } },
        ],
      },
      { id: "count", approval: "Fine?", show: "$steps.each.output" },
    ]);
    const { runs, close } = await openedRuns({ changes });
    const started = await runs.start(flow, ["a", "b"]);
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    assert.deepEqual(waiting.content, [
      { stored: "a", first: ["a", "b"] },
      { stored: "b", first: ["a", "b"] },
    ]);
    const run = runOf(await runs.resume(runOf(started).id));
    assert.deepEqual(
      run.steps.filter((step) => !step.key.includes("/")).map((step) => step.key),
      ["each", "each[0].put", "each[0].echo", "each[1].put", "each[1].echo", "count"],
    );
    close();
  });

  test("a foreach that waits inside is started once, however often the run is resumed", async () => {
    const changes = withFlow([{ id: "each", foreach: "$trigger", steps: [{ id: "pause", wait: "2h" }] }]);
    const { runs, clock, close } = await openedRuns({ changes });
    const id = runOf(await runs.start(flow, ["a", "b"])).id;
    assert.equal(waitingOf(await runs.resume(id)).stepKey, "each[0].pause");
    clock.advance(2 * hour);
    assert.equal(waitingOf(await runs.resume(id)).stepKey, "each[1].pause");
    clock.advance(2 * hour);
    const run = runOf(await runs.resume(id));
    assert.deepEqual(run.state, { status: "done", output: ["a", "b"] });
    const started = run.events.filter((event) => event.kind === "step.started");
    assert.deepEqual(
      started.map((event) => textField(event.detail, "stepKey")),
      ["each", "each[0].pause", "each[1].pause"],
    );
    close();
  });

  test("foreach over something that is not a list fails the run with a problem", async () => {
    const changes = withFlow([{ id: "each", foreach: "$trigger", steps: [{ id: "put", action: "log" }] }]);
    const { runs, runner, close } = await openedRuns({ changes });
    const run = runOf(await runs.start(flow, { not: "a list" }));
    assert.deepEqual(run.state, {
      status: "failed",
      reason: "Step each runs over $trigger, which is a mapping, not a list.",
    });
    assert.deepEqual(runner.calls, []);
    close();
  });

  test("a wait step parks the run until runs wake at or after its time", async () => {
    const changes = withFlow([
      { id: "first", action: "copy", input: { count: 1 } },
      { id: "pause", wait: "2h" },
      { id: "after", action: "copy" },
    ]);
    const { runs, runner, clock, close } = await openedRuns({ changes });
    const until = new Date(startTime.getTime() + 2 * hour).toISOString();
    const id = runOf(await runs.start(flow, null)).id;
    assert.deepEqual(runOf(await runs.show(id)).state, {
      status: "waiting",
      waiting: { reason: "time", stepKey: "pause", until },
    });
    clock.advance(hour);
    assert.deepEqual(await runs.wakeDue(), []);
    assert.equal(runner.calls.length, 3);
    clock.advance(hour);
    const [result, ...others] = await runs.wakeDue();
    assert.deepEqual(others, []);
    assert.ok(result);
    assert.deepEqual(runOf(result).state, { status: "done", output: { count: 13 } });
    assert.equal(runner.calls.length, 6);
    const second = runOf(await runs.start(flow, null));
    const secondUntil = new Date(startTime.getTime() + 4 * hour).toISOString();
    assert.deepEqual(waitingOf(await runs.resume(second.id)), { reason: "time", stepKey: "pause", until: secondUntil });
    close();
  });

  test("an approval records the hash of what it showed and continues only for that hash", async () => {
    const { runs, close } = await openedRuns({ changes: withFlow(reviewSteps) });
    const started = await runs.start(flow, 1);
    const id = runOf(started).id;
    const waiting = waitingOf(started);
    assert.deepEqual(waiting, {
      reason: "approval",
      stepKey: "keep",
      question: "Keep this count?",
      hash: hashOf({ count: 5 }),
      content: { count: 5 },
    });
    assert.ok(waiting.reason === "approval");
    const decision = { stepKey: "keep", verdict: "approve", by: "me" } as const;
    const wrong = await runs.approve(id, { ...decision, hash: "0".repeat(64) });
    assert.match(messagesOf(wrong), /is not the hash of what step keep showed/);
    assert.equal(waitingOf(await runs.resume(id)).reason, "approval");
    const elsewhere = await runs.approve(id, { ...decision, stepKey: "seed", hash: waiting.hash });
    assert.match(messagesOf(elsewhere), /not waiting for approval at step seed/);
    const run = runOf(await runs.approve(id, { ...decision, hash: waiting.hash }));
    assert.deepEqual(run.state, { status: "done", output: { count: 13 } });
    const recorded = run.events.find((event) => event.kind === "approval.recorded");
    assert.deepEqual(recorded?.detail, { stepKey: "keep", hash: waiting.hash, decision: "approve", by: "me" });
    assert.match(messagesOf(await runs.approve(id, { ...decision, hash: waiting.hash })), /has ended/);
    close();
  });

  test("when the shown content changes, approving the old hash returns the run to the approval", async () => {
    const changes = withFlow([{ id: "keep", approval: "Send this greeting?", show: "$settings.greeting" }]);
    const { runs, reopen, close } = await openedRuns({ changes });
    const started = await runs.start(flow, null);
    const id = runOf(started).id;
    const first = waitingOf(started);
    assert.ok(first.reason === "approval");
    const edited = await fixtureSystem({ ...changes, config: { settings: { notes: { greeting: "goodbye" } } } });
    const later = await reopen(edited.system);
    const decision = { stepKey: "keep", verdict: "approve", by: "me" } as const;
    const back = waitingOf(await later.approve(id, { ...decision, hash: first.hash }));
    assert.deepEqual(back, {
      reason: "approval",
      stepKey: "keep",
      question: "Send this greeting?",
      hash: hashOf("goodbye"),
      content: "goodbye",
      previousHash: hashOf("hello"),
    });
    assert.ok(!eventKinds(runOf(await later.show(id))).includes("approval.recorded"));
    const stale = await later.approve(id, { ...decision, hash: first.hash });
    assert.match(messagesOf(stale), /is not the hash/);
    const run = runOf(await later.approve(id, { ...decision, hash: hashOf("goodbye") }));
    assert.deepEqual(run.state, { status: "done", output: "goodbye" });
    close();
  });

  test("after the shown content changes, show gives the new content under its new hash", async () => {
    const changes = withFlow([{ id: "keep", approval: "Send this greeting?", show: "$settings.greeting" }]);
    const { runs, reopen, close } = await openedRuns({ changes });
    const started = await runs.start(flow, null);
    const id = runOf(started).id;
    const first = waitingOf(started);
    assert.ok(first.reason === "approval");
    assert.deepEqual(waitingOf(await runs.show(id)), first);
    const edited = await fixtureSystem({ ...changes, config: { settings: { notes: { greeting: "goodbye" } } } });
    const later = await reopen(edited.system);
    const back = waitingOf(await later.resume(id));
    assert.equal(back.reason === "approval" ? back.content : undefined, "goodbye");
    assert.deepEqual(waitingOf(await later.show(id)), back);
    close();
  });

  test("a rejected approval fails the run and undoes finished actions, newest first", async () => {
    const changes = withFlow([
      { id: "first", action: "items-store.put", input: { id: "a" } },
      { id: "note", action: "log", input: { text: "noted" } },
      { id: "wipe", action: "items-store.erase", input: { id: "old" } },
      { id: "second", action: "items-store.put", input: { id: "b" } },
      { id: "look", action: "items-store.get", input: { id: "b" } },
      { id: "keep", approval: "Keep both?" },
    ]);
    const { runs, runner, close } = await openedRuns({ changes });
    const started = await runs.start(flow, null);
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    const decision = { stepKey: "keep", hash: waiting.hash, verdict: "reject", by: "me" } as const;
    const run = runOf(await runs.approve(runOf(started).id, decision));
    assert.deepEqual(run.state, {
      status: "undone",
      reason: "me rejected step keep: Keep both?",
      undo: {
        undone: [
          { stepKey: "second", action: "store.put" },
          { stepKey: "first", action: "store.put" },
        ],
        failed: [],
        noUndo: [{ stepKey: "note", action: "notes.log" }],
        deleteNotUndone: [{ stepKey: "wipe", action: "store.erase" }],
      },
    });
    assert.deepEqual(
      run.steps.filter((step) => step.key.startsWith("undo")).map((step) => [step.key, step.kind, step.status]),
      [
        ["undo[0]", "undo", "done"],
        ["undo[0]/0", "script", "done"],
        ["undo[1]", "undo", "done"],
        ["undo[1]/0", "script", "done"],
      ],
    );
    assert.deepEqual(
      runner.runsOf("store:scripts/remove.ts").map((call) => call.input),
      [{ id: "b" }, { id: "a" }],
    );
    assert.equal(runner.runsOf("store:scripts/erase.ts").length, 1);
    close();
  });

  test("a failing undo is recorded and the remaining undos still run", async () => {
    const scripts = {
      "store:scripts/remove.ts": (request: ScriptRequest) =>
        textField(request.input, "id") === "b" ? failure("b is locked") : finished(request.input),
    };
    const changes = withFlow([
      { id: "first", action: "items-store.put", input: { id: "a" } },
      { id: "second", action: "items-store.put", input: { id: "b" } },
      { id: "boom", action: "store-then-fail", input: { id: "c" } },
    ]);
    const { runs, runner, close } = await openedRuns({ scripts, changes });
    const run = runOf(await runs.start(flow, null));
    assert.deepEqual(run.state, {
      status: "undone",
      reason: "the script gave up",
      undo: {
        undone: [
          { stepKey: "boom/0", action: "store.put" },
          { stepKey: "first", action: "store.put" },
        ],
        failed: [{ stepKey: "second", action: "store.put", reason: "b is locked" }],
        noUndo: [],
        deleteNotUndone: [],
      },
    });
    assert.deepEqual(
      runner.runsOf("store:scripts/remove.ts").map((call) => call.input),
      [{ id: "c" }, { id: "b" }, { id: "a" }],
    );
    close();
  });

  test("a finished action without an undo is listed, and the actions it called are undone", async () => {
    const changes = withFlow([
      { id: "kept", action: "store-one", input: { id: "a" } },
      { id: "keep", approval: "Keep?" },
    ]);
    const { runs, runner, close } = await openedRuns({ changes });
    const started = await runs.start(flow, null);
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    const decision = { stepKey: "keep", hash: waiting.hash, verdict: "reject", by: "me" } as const;
    const run = runOf(await runs.approve(runOf(started).id, decision));
    assert.ok(run.state.status === "undone");
    assert.deepEqual(run.state.undo.undone, [{ stepKey: "kept/0", action: "store.put" }]);
    assert.deepEqual(run.state.undo.noUndo, [{ stepKey: "kept", action: "notes.store-one" }]);
    assert.equal(runner.runsOf("store:scripts/remove.ts").length, 1);
    close();
  });

  test("an action with an undo covers only its own steps, not those of a step whose id starts with its id", async () => {
    const changes = withFlow([
      { id: "keep", action: "items-store.put", input: { id: "a" } },
      { id: "keep-more", action: "store-one", input: { id: "b" } },
      { id: "fail", action: "store-then-fail", input: { id: "c" } },
    ]);
    const { runs, close } = await openedRuns({ changes });
    const run = runOf(await runs.start(flow, null));
    assert.ok(run.state.status === "undone");
    assert.deepEqual(run.state.undo.undone, [
      { stepKey: "fail/0", action: "store.put" },
      { stepKey: "keep-more/0", action: "store.put" },
      { stepKey: "keep", action: "store.put" },
    ]);
    close();
  });

  test("a foreach named undo is undone like any other step, not taken for the undo itself", async () => {
    const changes = withFlow([
      { id: "undo", foreach: "$trigger", steps: [{ id: "put", action: "items-store.put", input: { id: "$item" } }] },
      { id: "keep", approval: "Keep?" },
    ]);
    const { runs, runner, close } = await openedRuns({ changes });
    const started = await runs.start(flow, ["a", "b"]);
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    const decision = { stepKey: "keep", hash: waiting.hash, verdict: "reject", by: "me" } as const;
    const run = runOf(await runs.approve(runOf(started).id, decision));
    assert.ok(run.state.status === "undone");
    assert.deepEqual(run.state.undo.undone, [
      { stepKey: "undo[1].put", action: "store.put" },
      { stepKey: "undo[0].put", action: "store.put" },
    ]);
    assert.deepEqual(
      runner.runsOf("store:scripts/remove.ts").map((call) => call.input),
      [{ id: "b" }, { id: "a" }],
    );
    close();
  });

  test("a run that fails with nothing written ends failed, with no undo", async () => {
    const changes = withFlow([
      { id: "look", action: "items-store.get", input: { id: "a" } },
      { id: "keep", approval: "Keep?" },
    ]);
    const { runs, close } = await openedRuns({ changes });
    const started = await runs.start(flow, null);
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    const decision = { stepKey: "keep", hash: waiting.hash, verdict: "reject", by: "me" } as const;
    const run = runOf(await runs.approve(runOf(started).id, decision));
    assert.deepEqual(run.state, { status: "failed", reason: "me rejected step keep: Keep?" });
    assert.ok(!eventKinds(run).includes("undo.started"));
    close();
  });
});

test("an action run that fails after a call wrote something undoes that call", async () => {
  const { runs, runner, close } = await openedRuns();
  const run = runOf(await runs.start({ action: "notes.store-then-fail" }, { id: "x" }));
  assert.ok(run.state.status === "undone");
  assert.deepEqual(run.state.undo.undone, [{ stepKey: "0", action: "store.put" }]);
  assert.deepEqual(
    runner.runsOf("store:scripts/remove.ts").map((call) => [call.input, call.permissions.grants.mode]),
    [[{ id: "x" }, "store"]],
  );
  close();
});

test("starting a workflow that does not exist is refused", async () => {
  const { runs, close } = await openedRuns();
  const nowhere = await runs.start({ workflow: { mode: "notes", path: "nowhere.yaml" } }, null);
  assert.match(messagesOf(nowhere), /Mode notes has no workflow nowhere.yaml/);
  close();
});

test("an approval event written into the log by anyone but the engine passes nothing", async () => {
  const { runs, close } = await openedRuns({ changes: withFlow(reviewSteps) });
  const started = await runs.start(flow, 1);
  const id = runOf(started).id;
  const waiting = waitingOf(started);
  assert.ok(waiting.reason === "approval");
  const forged = { stepKey: "keep", hash: waiting.hash, decision: "approve", by: "someone" };
  await runs.events.append({ at: startTime.toISOString(), runId: id, kind: "approval.recorded", detail: forged });
  assert.deepEqual(waitingOf(await runs.resume(id)), waiting);
  close();
});

test("runs refuse to start an action or a workflow of a mode that is not active in the project", async () => {
  const { runs, reopen, runner, close } = await openedRuns({ changes: withFlow(reviewSteps) });
  const onlyStore = await fixtureSystem({ ...withFlow(reviewSteps), activeModes: ["store"] });
  const inactive = await reopen(onlyStore.system);
  const sentence = "Mode notes is not active in this project, so nothing of it runs here.";
  const fix = "Add notes to modes: in agentbay.config.yaml, or bind an interface it implements.";
  for (const result of [await inactive.start({ action: "notes.copy" }, { count: 1 }), await inactive.start(flow, 1)]) {
    assert.ok(!result.ok);
    assert.deepEqual(
      result.problems.map((problem) => [problem.message, problem.fix]),
      [[sentence, fix]],
    );
  }
  assert.equal(runner.calls.length, 0);
  const active = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
  assert.equal(active.state.status, "done");
  close();
});

test("a run of a mode that is no longer active is refused when it would advance, and left as it was", async () => {
  const { runs, reopen, close } = await openedRuns({ changes: withFlow(reviewSteps) });
  const waiting = runOf(await runs.start(flow, 1));
  assert.equal(waiting.state.status, "waiting");
  const onlyStore = await fixtureSystem({ ...withFlow(reviewSteps), activeModes: ["store"] });
  const inactive = await reopen(onlyStore.system);
  for (const result of [await inactive.resume(waiting.id), await inactive.stop(waiting.id, "The owner")]) {
    assert.deepEqual(problemsOf(result), ["Mode notes is not active in this project, so nothing of it runs here."]);
  }
  assert.equal(runOf(await runs.show(waiting.id)).state.status, "waiting");
  close();
});

test("one representative run emits every event kind, in order, with ids and sizes but no payloads", async () => {
  const steps = [
    { id: "draft", action: "draft-and-store", input: { topic: "$trigger" } },
    { id: "keep", approval: "Keep the stored draft?" },
  ];
  const changes = { ...withFlow(steps), config: { budget: { items: 1 } } };
  const { runs, close } = await openedRuns({ changes });
  const started = runOf(await runs.start(flow, "staking"));
  const submitted = await runs.submit(tokenOf(started), answer({ id: "d1", text: "PRIVATE-DRAFT-BODY" }));
  assert.equal(waitingOf(submitted).reason, "budget");
  const approval = waitingOf(await runs.extend(started.id, { items: 5 }, "The owner"));
  assert.ok(approval.reason === "approval");
  const decision = { stepKey: "keep", hash: approval.hash, verdict: "reject", by: "owner" } as const;
  const run = runOf(await runs.approve(started.id, decision));
  assert.equal(run.state.status, "undone");
  assert.deepEqual(eventKinds(run), [
    "run.started",
    "step.started",
    "step.started",
    "run.waiting",
    "tool.called",
    "skill.hook",
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
  const events = JSON.stringify(run.events);
  assert.ok(!events.includes("PRIVATE-DRAFT-BODY"));
  assert.ok(!events.includes("staking"));
  const draftFinished = run.events.find((event) => event.kind === "step.finished");
  assert.deepEqual(draftFinished?.detail, {
    stepKey: "draft/0",
    kind: "skill",
    outputBytes: Buffer.byteLength(JSON.stringify({ id: "d1", text: "PRIVATE-DRAFT-BODY" })),
    spent: { items: 0, usd: 0, tokens: 0, minutes: 0 },
  });
  close();
});

test("a binding that vanished cannot be loaded, so no run resumes over a call or workflow action without it", async () => {
  const changes = withFlow([
    { id: "keep", approval: "Go?" },
    { id: "put", action: "items-store.put", input: { id: "a" } },
  ]);
  assert.deepEqual(await fixtureRefusal({ ...changes, config: { bindings: {} } }), [
    "Mode notes requires items-store@1, but bindings names no mode for items-store.",
  ]);
});

test("an undo runs to its end even when its own budget is spent", async () => {
  const keep = {
    description: "When a test keeps something.",
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["write" as const],
    run: [{ script: "scripts/log.ts" }],
    undo: "unkeep",
  };
  const unkeep = {
    description: "When a test takes back what it kept.",
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["write" as const, "spend" as const],
    run: [{ script: "scripts/spend.ts" }, { script: "scripts/spend.ts" }],
    budget: { items: 0 },
  };
  const steps = [
    { id: "kept", action: "keep", input: { measure: "items" } },
    { id: "decide", approval: "Keep it?" },
  ];
  const { runs, runner, close } = await openedRuns({ changes: { ...withFlow(steps), notesActions: { keep, unkeep } } });
  const started = await runs.start(flow, null);
  const waiting = waitingOf(started);
  assert.ok(waiting.reason === "approval");
  const decision = { stepKey: "decide", hash: waiting.hash, verdict: "reject", by: "me" } as const;
  const run = runOf(await runs.approve(runOf(started).id, decision));
  assert.deepEqual(run.state, {
    status: "undone",
    reason: "me rejected step decide: Keep it?",
    undo: { undone: [{ stepKey: "kept", action: "notes.keep" }], failed: [], noUndo: [], deleteNotUndone: [] },
  });
  assert.equal(runner.runsOf("notes:scripts/spend.ts").length, 2);
  close();
});
