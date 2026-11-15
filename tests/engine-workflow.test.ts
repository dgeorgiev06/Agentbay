import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { hashOf, textField } from "../bay/json.ts";
import {
  eventKinds,
  failure,
  finished,
  fixtureSystem,
  harness,
  problemsOf,
  runOf,
  startTime,
  storeKinds,
  waitingOf,
} from "./engine-fixture.ts";

const flow = "workflows/flow.yaml";

function withFlow(steps: Workflow["steps"]): { readonly workflows: Readonly<Record<string, Workflow>> } {
  return { workflows: { [flow]: { name: "flow", steps } } };
}

const notesFlow = { mode: "notes", path: flow };

const reviewSteps: Workflow["steps"] = [
  { id: "seed", action: "copy", input: { count: "$trigger" } },
  { id: "keep", approval: "Keep this count?", show: "$steps.seed.output" },
  { id: "after", action: "copy" },
];

for (const storeKind of storeKinds) {
  describe(`engine workflows on the ${storeKind} store`, () => {
    test("action steps take literal and referenced input, and later steps see earlier outputs", async () => {
      const changes = withFlow([
        { id: "seed", action: "copy", input: { count: "$trigger" } },
        { id: "again", action: "copy", input: { count: "$steps.seed.output.count" } },
        { id: "keep", action: "items-store.put", input: { id: "$settings.greeting" } },
        { id: "chained", action: "copy", input: { count: 0 } },
        { id: "last", action: "log" },
      ]);
      const { engine, close } = await harness({ storeKind, changes });
      const run = runOf(await engine.startWorkflow(notesFlow, 1));
      assert.deepEqual(run.state, { status: "done", output: { count: 3 } });
      const inputs = Object.fromEntries(
        run.steps.filter((step) => !step.key.includes("/")).map((s) => [s.key, s.input]),
      );
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
      const { engine, runner, close } = await harness({ storeKind, changes });
      const run = runOf(await engine.startWorkflow(notesFlow, 1));
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
      const { engine, close } = await harness({ storeKind, changes });
      const waiting = waitingOf(await engine.startWorkflow(notesFlow, ["a", "b"]));
      assert.ok(waiting.reason === "approval");
      assert.deepEqual(waiting.content, [
        { stored: "a", first: ["a", "b"] },
        { stored: "b", first: ["a", "b"] },
      ]);
      const run = runOf(await engine.resume("run-1"));
      assert.deepEqual(
        run.steps.filter((step) => !step.key.includes("/")).map((step) => step.key),
        ["each", "each[0].put", "each[0].echo", "each[1].put", "each[1].echo", "count"],
      );
      close();
    });

    test("foreach over something that is not a list fails the run with a problem", async () => {
      const changes = withFlow([{ id: "each", foreach: "$trigger", steps: [{ id: "put", action: "log" }] }]);
      const { engine, runner, close } = await harness({ storeKind, changes });
      const run = runOf(await engine.startWorkflow(notesFlow, { not: "a list" }));
      assert.deepEqual(run.state, {
        status: "failed",
        reason: "Step each runs over $trigger, which is a mapping, not a list.",
      });
      assert.deepEqual(runner.calls, []);
      close();
    });

    test("a wait step parks the run until tick is called at or after its time", async () => {
      const changes = withFlow([
        { id: "first", action: "copy", input: { count: 1 } },
        { id: "pause", wait: "2h" },
        { id: "after", action: "copy" },
      ]);
      const { engine, store, runner, close } = await harness({ storeKind, changes });
      const until = new Date(startTime.getTime() + 2 * 3_600_000).toISOString();
      const id = runOf(await engine.startWorkflow(notesFlow, null)).id;
      assert.deepEqual((await store.readRun(id))?.state, {
        status: "waiting",
        reason: "time",
        stepKey: "pause",
        until,
      });
      assert.deepEqual(await engine.tick(new Date(startTime.getTime() + 3_600_000)), []);
      assert.equal(runner.calls.length, 3);
      const [result, ...others] = await engine.tick(new Date(until));
      assert.deepEqual(others, []);
      assert.ok(result);
      assert.deepEqual(runOf(result).state, { status: "done", output: { count: 13 } });
      assert.equal(runner.calls.length, 6);
      assert.equal(waitingOf(await engine.startWorkflow(notesFlow, null, { id: "second" })).reason, "time");
      const early = await engine.resume("second");
      assert.deepEqual(waitingOf(early), { reason: "time", stepKey: "pause", until });
      close();
    });

    test("an approval records the hash of what it showed and continues only for that hash", async () => {
      const { engine, store, close } = await harness({ storeKind, changes: withFlow(reviewSteps) });
      const waiting = waitingOf(await engine.startWorkflow(notesFlow, 1));
      assert.deepEqual(waiting, {
        reason: "approval",
        stepKey: "keep",
        question: "Keep this count?",
        hash: hashOf({ count: 5 }),
        content: { count: 5 },
      });
      const wrong = problemsOf(
        await engine.approve("run-1", "keep", { hash: "0".repeat(64), decision: "approve", by: "me" }),
      );
      assert.match(wrong[0] ?? "", /is not the hash of what step keep showed/);
      assert.equal(waitingOf(await engine.resume("run-1")).reason, "approval");
      assert.ok(waiting.reason === "approval");
      const elsewhere = await engine.approve("run-1", "seed", { hash: waiting.hash, decision: "approve", by: "me" });
      assert.match(problemsOf(elsewhere)[0] ?? "", /not waiting for approval at step seed/);
      const run = runOf(await engine.approve("run-1", "keep", { hash: waiting.hash, decision: "approve", by: "me" }));
      assert.deepEqual(run.state, { status: "done", output: { count: 13 } });
      const recorded = (await store.readEvents("run-1")).find((event) => event.kind === "approval.recorded");
      assert.deepEqual(recorded?.detail, { stepKey: "keep", hash: waiting.hash, decision: "approve", by: "me" });
      assert.match(
        problemsOf(await engine.approve("run-1", "keep", { hash: waiting.hash, decision: "approve", by: "me" }))[0] ??
          "",
        /has ended/,
      );
      close();
    });

    test("when the shown content changes, approving the old hash returns the run to the approval", async () => {
      const changes = withFlow([{ id: "keep", approval: "Send this greeting?", show: "$settings.greeting" }]);
      const { engine, store, freshEngine, close } = await harness({ storeKind, changes });
      const first = waitingOf(await engine.startWorkflow(notesFlow, null));
      assert.ok(first.reason === "approval");
      const edited = await fixtureSystem({ ...changes, config: { settings: { notes: { greeting: "goodbye" } } } });
      const later = freshEngine({ system: edited.system });
      const back = waitingOf(await later.approve("run-1", "keep", { hash: first.hash, decision: "approve", by: "me" }));
      assert.deepEqual(back, {
        reason: "approval",
        stepKey: "keep",
        question: "Send this greeting?",
        hash: hashOf("goodbye"),
        content: "goodbye",
        previousHash: hashOf("hello"),
      });
      assert.ok(!(await eventKinds(store, "run-1")).includes("approval.recorded"));
      const stale = await later.approve("run-1", "keep", { hash: first.hash, decision: "approve", by: "me" });
      assert.match(problemsOf(stale)[0] ?? "", /is not the hash/);
      const run = runOf(
        await later.approve("run-1", "keep", { hash: hashOf("goodbye"), decision: "approve", by: "me" }),
      );
      assert.deepEqual(run.state, { status: "done", output: "goodbye" });
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
      const { engine, runner, close } = await harness({ storeKind, changes });
      const waiting = waitingOf(await engine.startWorkflow(notesFlow, null));
      assert.ok(waiting.reason === "approval");
      const run = runOf(await engine.approve("run-1", "keep", { hash: waiting.hash, decision: "reject", by: "me" }));
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
      const { engine, runner, close } = await harness({ storeKind, scripts, changes });
      const run = runOf(await engine.startWorkflow(notesFlow, null));
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
      const { engine, runner, close } = await harness({ storeKind, changes });
      const waiting = waitingOf(await engine.startWorkflow(notesFlow, null));
      assert.ok(waiting.reason === "approval");
      const run = runOf(await engine.approve("run-1", "keep", { hash: waiting.hash, decision: "reject", by: "me" }));
      assert.ok(run.state.status === "undone");
      assert.deepEqual(run.state.undo.undone, [{ stepKey: "kept/0", action: "store.put" }]);
      assert.deepEqual(run.state.undo.noUndo, [{ stepKey: "kept", action: "notes.store-one" }]);
      assert.equal(runner.runsOf("store:scripts/remove.ts").length, 1);
      close();
    });

    test("a run that fails with nothing written ends failed, with no undo", async () => {
      const changes = withFlow([
        { id: "look", action: "items-store.get", input: { id: "a" } },
        { id: "keep", approval: "Keep?" },
      ]);
      const { engine, store, close } = await harness({ storeKind, changes });
      const waiting = waitingOf(await engine.startWorkflow(notesFlow, null));
      assert.ok(waiting.reason === "approval");
      const run = runOf(await engine.approve("run-1", "keep", { hash: waiting.hash, decision: "reject", by: "me" }));
      assert.deepEqual(run.state, { status: "failed", reason: "me rejected step keep: Keep?" });
      assert.ok(!(await eventKinds(store, "run-1")).includes("undo.started"));
      close();
    });
  });
}

test("an action run that fails after a call wrote something undoes that call", async () => {
  const { engine, runner, close } = await harness();
  const run = runOf(await engine.startAction("notes.store-then-fail", { id: "x" }));
  assert.ok(run.state.status === "undone");
  assert.deepEqual(run.state.undo.undone, [{ stepKey: "0", action: "store.put" }]);
  assert.deepEqual(
    runner.runsOf("store:scripts/remove.ts").map((call) => [call.input, call.permissions.mode]),
    [[{ id: "x" }, "store"]],
  );
  close();
});

test("starting a workflow that does not exist is refused", async () => {
  const { engine, close } = await harness();
  assert.match(
    problemsOf(await engine.startWorkflow({ mode: "notes", path: "nowhere.yaml" }, null))[0] ?? "",
    /no workflow/,
  );
  close();
});
