import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawn, Json, ScriptRequest } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { fieldOf, numberField } from "../bay/json.ts";
import type { Run } from "../bay/runs/runs.ts";
import {
  answer,
  failure,
  finished,
  messagesOf,
  notesFlow,
  openedRuns,
  runOf,
  startTime,
  tokenOf,
  withFlow,
  type Script,
} from "./runs-fixture.ts";

const drawing: Action = {
  description: "When a test draws random values and reads the time.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read", "write"],
  run: [{ script: "scripts/log.ts" }],
};

const changes = { notesActions: { draw: drawing } };

function valueOf(drawn: Drawn): string {
  assert.ok(drawn.status === "done", JSON.stringify(drawn));
  return drawn.value;
}

function reasonOf(drawn: Drawn): string {
  assert.ok(drawn.status === "failed", JSON.stringify(drawn));
  return drawn.reason;
}

type Attempt = {
  readonly values: readonly string[];
  readonly now: string;
};

function recorded(attempts: Attempt[], request: ScriptRequest, values: readonly string[]): void {
  attempts.push({ values, now: request.startedAt.toISOString() });
}

function drawnOf(run: Run, key: string): Json | undefined {
  const step = run.steps.find((candidate) => candidate.key === key);
  return fieldOf(step?.detail ?? null, "drawn");
}

async function drawnIdOf(runs: Awaited<ReturnType<typeof openedRuns>>["runs"]): Promise<string> {
  const [listed] = await runs.list();
  return listed?.id ?? "";
}

test("a step that died after drawing gets the same values and time when the owner runs it again", async () => {
  const attempts: Attempt[] = [];
  const draw: Script = async (request) => {
    const values = [valueOf(await request.random(16)), valueOf(await request.random(8))];
    if (attempts.length === 0) {
      recorded(attempts, request, values);
      throw new Error("the process died");
    }
    recorded(attempts, request, [...values, valueOf(await request.random(4))]);
    return finished({ values });
  };
  const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": draw }, changes });
  assert.match(messagesOf(await opened.runs.start({ action: "notes.draw" }, {})), /the process died/);
  const id = await drawnIdOf(opened.runs);
  opened.clock.advance(60 * 60 * 1000);
  const asked = runOf(await opened.runs.resume(id));
  assert.ok(asked.state.status === "waiting" && asked.state.waiting.reason === "owner");
  const done = runOf(await opened.runs.rerun(id, "The owner"));
  assert.equal(done.state.status, "done");
  const [first, second] = attempts;
  assert.ok(first !== undefined && second !== undefined);
  assert.deepEqual(second.values.slice(0, 2), first.values);
  assert.match(first.values[0] ?? "", /^[0-9a-f]{32}$/);
  assert.match(first.values[1] ?? "", /^[0-9a-f]{16}$/);
  assert.match(second.values[2] ?? "", /^[0-9a-f]{8}$/);
  assert.deepEqual([first.now, second.now], [startTime.toISOString(), startTime.toISOString()]);
  assert.deepEqual(drawnOf(done, "0"), second.values);
  opened.close();
});

test("a step that stopped for a called action draws the same values when the run goes on", async () => {
  const seen: string[] = [];
  const draw: Script = async (request) => {
    const value = valueOf(await request.random(16));
    seen.push(value);
    const called = await request.call("draft", { topic: "tea" });
    return called.status === "done" ? finished({ value, called: called.output }) : failure(called.reason);
  };
  const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": draw }, changes });
  const started = runOf(await opened.runs.start({ action: "notes.draw" }, {}));
  const done = runOf(await opened.runs.submit(tokenOf(started), answer({ text: "long enough text" })));
  assert.equal(done.state.status, "done", JSON.stringify(done.state));
  assert.equal(seen.length, 2);
  assert.equal(seen[1], seen[0]);
  opened.close();
});

function itemOf(request: ScriptRequest): number {
  return numberField(request.input, "n") ?? -1;
}

test("a foreach item's new attempt draws new values, and the first attempt's stay with its own step", async () => {
  const byItem = new Map<number, string[]>();
  const draw: Script = async (request) => {
    const item = itemOf(request);
    const values = byItem.get(item) ?? [];
    values.push(valueOf(await request.random(16)));
    byItem.set(item, values);
    return item === 0 && values.length === 1 ? failure("item 0 broke") : finished({ n: item });
  };
  const steps: Workflow["steps"] = [
    { id: "each", foreach: "$trigger", sideBySide: 2, steps: [{ id: "do", action: "draw", input: { n: "$item" } }] },
  ];
  const flowChanges = { ...withFlow(steps), notesActions: { draw: drawing } };
  const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": draw }, changes: flowChanges });
  const started = runOf(await opened.runs.start({ workflow: notesFlow }, [0, 1]));
  const done = runOf(await opened.runs.rerun(started.id, "The owner"));
  assert.equal(done.state.status, "done", JSON.stringify(done.state));
  const [first, again] = byItem.get(0) ?? [];
  assert.ok(first !== undefined && again !== undefined);
  assert.notEqual(again, first);
  assert.deepEqual(drawnOf(done, "each[0].do/0"), [first]);
  assert.deepEqual(drawnOf(done, "each[0]~2.do/0"), [again]);
  opened.close();
});

test("a step records at most 64 random values, and a 65th is refused with a sentence", async () => {
  const draw: Script = async (request) => {
    const values: string[] = [];
    for (let index = 0; index < 64; index += 1) {
      values.push(valueOf(await request.random(1)));
    }
    return finished({ count: values.length, over: reasonOf(await request.random(1)) });
  };
  const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": draw }, changes });
  const done = runOf(await opened.runs.start({ action: "notes.draw" }, {}));
  assert.deepEqual(done.state, {
    status: "done",
    output: { count: 64, over: "Step 0 has drawn 64 random values, the most one step records." },
  });
  opened.close();
});

test("a step run again that asks for a value of another size than the one recorded is told so", async () => {
  let attempts = 0;
  const draw: Script = async (request) => {
    attempts += 1;
    if (attempts === 1) {
      valueOf(await request.random(16));
      throw new Error("the process died");
    }
    return finished({ asked: reasonOf(await request.random(8)) });
  };
  const opened = await openedRuns({ scripts: { "notes:scripts/log.ts": draw }, changes });
  await opened.runs.start({ action: "notes.draw" }, {});
  const id = await drawnIdOf(opened.runs);
  await opened.runs.resume(id);
  const done = runOf(await opened.runs.rerun(id, "The owner"));
  assert.deepEqual(done.state, {
    status: "done",
    output: {
      asked:
        "Random value 1 of step 0 was drawn as 16 bytes when the step first ran, and 8 are asked now; " +
        "a step that runs again asks for its values in the same order and sizes.",
    },
  });
  opened.close();
});
