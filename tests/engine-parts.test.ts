import assert from "node:assert/strict";
import { test } from "node:test";
import { charge, rootFrame } from "../bay/runs/budget.ts";
import type { StepRecord } from "../bay/runs/run-store.ts";
import { resolveActionReference, resolveCall, resolveOwnAction, resolveWorkflowAction } from "../bay/targets.ts";
import { gate, replayed, stopGate, type Walk } from "../bay/runs/walk.ts";
import { fixtureSystem, harness, notesFlow, runOf, startTime, withFlow } from "./engine-fixture.ts";

const spent = { items: 1, usd: 0, tokens: 0, minutes: 0 };

function finishedAction(key: string, action: string, order: number): StepRecord {
  const [mode = "", name = ""] = action.split(".");
  return {
    key,
    kind: "call",
    input: {},
    detail: { mode, action: name },
    startedAt: "t",
    status: "done",
    output: { id: key },
    spent,
    finishOrder: order,
    finishedAt: "t",
  };
}

async function walkOf(changes: Partial<Pick<Walk, "phase" | "stopReason">>): Promise<Walk> {
  const { system, policyOf, files, store, close } = await harness();
  close();
  const services = {
    system,
    store,
    runner: { run: () => Promise.reject(new Error("no scripts here")) },
    policyOf,
    clock: { now: () => startTime },
    files,
  };
  const base: Walk = {
    services,
    writer: { runId: "r", owner: "o" },
    records: new Map(),
    now: startTime,
    rerunUnfinished: false,
    stopReason: undefined,
    extra: {},
    phase: "main",
  };
  return { ...base, ...changes };
}

test("replayed returns the saved result of a settled step and charges its spend; a started step replays nothing", () => {
  const budget = rootFrame({ items: 5 });
  assert.equal(replayed(budget, undefined), undefined);
  const started: StepRecord = {
    key: "0",
    kind: "script",
    input: 1,
    detail: { script: "scripts/a.ts" },
    startedAt: "t",
    status: "started",
  };
  assert.equal(replayed(budget, started), undefined);
  assert.deepEqual(replayed(budget, finishedAction("0", "store.put", 1)), { status: "done", output: { id: "0" } });
  const failed: StepRecord = { ...started, status: "failed", reason: "no", spent, finishOrder: 2, finishedAt: "t" };
  assert.deepEqual(replayed(budget, failed), { status: "failed", reason: "no" });
  assert.equal(budget.spent.items, 2);
});

test("the gate stops a stopped run, holds an overspent one, and lets the undo phase through", async () => {
  const over = rootFrame({ items: 0 });
  charge(over, spent);
  const main = await walkOf({});
  assert.deepEqual(gate(main, rootFrame({}), "0"), undefined);
  assert.deepEqual(gate(main, over, "3"), {
    status: "waiting",
    waiting: { reason: "budget", stepKey: "3", overrun: { measure: "items", limit: 0, spent: 1 } },
  });
  const stopped = await walkOf({ stopReason: "stop" });
  assert.deepEqual(gate(stopped, over, "3"), { status: "failed", reason: "stop" });
  assert.deepEqual(stopGate(stopped), { status: "failed", reason: "stop" });
  const undoing = await walkOf({ stopReason: "stop", phase: "undo" });
  assert.equal(gate(undoing, over, "3"), undefined);
  assert.equal(stopGate(undoing), undefined);
});

test("targets resolve own actions, interface calls through bindings, and say plainly what is missing", async () => {
  const { system } = await fixtureSystem();
  const notes = system.modes.get("notes");
  assert.ok(notes);
  const call = resolveCall(system, notes, "items-store.put");
  assert.ok(typeof call !== "string");
  assert.equal(call.mode.manifest.name, "store");
  assert.equal(call.name, "put");
  const own = resolveWorkflowAction(system, notes, "copy");
  assert.ok(typeof own !== "string");
  assert.equal(own.mode.manifest.name, "notes");
  assert.equal(
    resolveCall(system, notes, "mail.fetch"),
    "Mode notes calls mail.fetch, but it does not require the interface mail.",
  );
  assert.equal(
    resolveCall(system, notes, "put"),
    "put does not name an action of an interface; write <interface>.<action>.",
  );
  const unbound = { ...system, config: { ...system.config, bindings: {} } };
  assert.equal(
    resolveCall(unbound, notes, "items-store.put"),
    "Mode notes calls items-store.put, but no mode is bound to items-store@1 for it.",
  );
  assert.equal(resolveActionReference(system, "notes"), "notes does not name an action; write <mode>.<action>.");
  const reserved = resolveOwnAction(system, "notes", "constructor");
  assert.ok(typeof reserved === "string");
  assert.match(reserved, /has no action constructor/);
  assert.equal(resolveOwnAction(system, "ghost", "x"), "There is no mode ghost.");
});

test("a call or workflow action whose binding vanished before resume fails the step with a plain reason", async () => {
  const changes = withFlow([
    { id: "keep", approval: "Go?" },
    { id: "put", action: "items-store.put", input: { id: "a" } },
  ]);
  const { engine, system, freshEngine, close } = await harness({ changes });
  const unbound = freshEngine({ system: { ...system, config: { ...system.config, bindings: {} } } });
  const reason = "Mode notes calls items-store.put, but no mode is bound to items-store@1 for it.";
  const id = runOf(await engine.startAction("notes.draft-and-store", {})).id;
  const run = runOf(await unbound.submit(id, "0#1", { output: { id: "d1", text: "draft" }, spent }));
  assert.deepEqual(run.state, { status: "failed", reason });
  const flow = runOf(await engine.startWorkflow(notesFlow, null, { id: "flow" }));
  assert.ok(flow.state.status === "waiting" && flow.state.waiting.reason === "approval");
  const decision = { hash: flow.state.waiting.hash, decision: "approve", by: "owner" } as const;
  assert.deepEqual(runOf(await unbound.approve("flow", "keep", decision)).state, { status: "failed", reason });
  close();
});
