import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { numberField } from "../bay/json.ts";
import type { Run, Runs } from "../bay/runs/runs.ts";
import {
  answer,
  failure,
  finished,
  notesFlow,
  openedRuns,
  runOf,
  withFlow,
  type OpenedRuns,
  type Script,
} from "./runs-fixture.ts";

type FakeClock = OpenedRuns["clock"];

const flow = { workflow: notesFlow };

type Waits = readonly Extract<Run["state"], { readonly status: "waiting" }>["waiting"][];

type Waiter = {
  readonly name: string;
  readonly step: Workflow["steps"][number];
  readonly answered: (runs: Runs, clock: FakeClock, run: Run) => Promise<Run>;
};

function waitsOf(run: Run): Waits {
  const state = run.state;
  assert.ok(state.status === "waiting", JSON.stringify(state));
  return [state.waiting, ...(state.alsoWaiting ?? [])];
}

function itemOf(request: ScriptRequest): number {
  return numberField(request.input, "n") ?? -1;
}

function waitFor(run: Run, reason: Waits[number]["reason"]): Waits[number] {
  const found = waitsOf(run).find((waiting) => waiting.reason === reason);
  assert.ok(found !== undefined, JSON.stringify(run.state));
  return found;
}

async function submitted(runs: Runs, _clock: FakeClock, run: Run): Promise<Run> {
  const waiting = waitFor(run, "skill");
  assert.ok(waiting.reason === "skill");
  const token = waiting.task.token ?? "";
  return runOf(await runs.submit(token, answer({ text: "long enough text" })));
}

async function ticked(runs: Runs, clock: FakeClock, run: Run): Promise<Run> {
  waitFor(run, "time");
  clock.advance(2 * 60 * 60 * 1000);
  const [woken] = await runs.wakeDue();
  assert.ok(woken !== undefined, "no run woke");
  return runOf(woken);
}

async function approved(runs: Runs, _clock: FakeClock, run: Run): Promise<Run> {
  const waiting = waitFor(run, "approval");
  assert.ok(waiting.reason === "approval");
  const { stepKey, hash } = waiting;
  return runOf(await runs.approve(run.id, { stepKey, hash, verdict: "approve", by: "the owner" }));
}

const waiters: readonly Waiter[] = [
  { name: "a submit", step: { id: "then", action: "draft", input: { topic: "tea" } }, answered: submitted },
  { name: "a tick", step: { id: "then", wait: "2h" }, answered: ticked },
  { name: "an approval", step: { id: "then", approval: "Keep it?", show: "$item" }, answered: approved },
];

function eachThen(waiter: Waiter): Workflow["steps"] {
  const steps = [{ id: "do", action: "log", input: { n: "$item" } }, waiter.step];
  return [{ id: "each", foreach: "$trigger", sideBySide: 2, steps }];
}

function ownerAsked(run: Run): string {
  return waitFor(run, "owner").stepKey;
}

for (const waiter of waiters) {
  test(`${waiter.name} for one item leaves another item's failure failed and the owner's question standing`, async () => {
    const calls = new Map<number, number>();
    const log: Script = (request) => {
      const item = itemOf(request);
      calls.set(item, (calls.get(item) ?? 0) + 1);
      return item === 0 ? failure("item 0 broke") : finished({ n: item });
    };
    const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes: withFlow(eachThen(waiter)) });
    const started = runOf(await opened.runs.start(flow, [0, 1]));
    assert.equal(ownerAsked(started), "each");
    const after = await waiter.answered(opened.runs, opened.clock, started);
    assert.equal(ownerAsked(after), "each", JSON.stringify(after.state));
    assert.equal(calls.get(0), 1);
    assert.ok(!after.steps.some((step) => step.key.startsWith("each[0]~2")));
    opened.close();
  });

  test(`${waiter.name} for one item does not run again another item's unfinished step that writes`, async () => {
    const calls = new Map<number, number>();
    const log: Script = async (request) => {
      const item = itemOf(request);
      calls.set(item, (calls.get(item) ?? 0) + 1);
      if (item === 0) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error("the process died");
      }
      return finished({ n: item });
    };
    const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes: withFlow(eachThen(waiter)) });
    await opened.runs.start(flow, [0, 1]);
    const [listed] = await opened.runs.list();
    const asked = runOf(await opened.runs.resume(listed?.id ?? ""));
    assert.equal(ownerAsked(asked), "each[0].do/0");
    const after = await waiter.answered(opened.runs, opened.clock, asked);
    assert.equal(ownerAsked(after), "each[0].do/0", JSON.stringify(after.state));
    assert.equal(calls.get(0), 1);
    opened.close();
  });
}
