import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { numberField, textField } from "../bay/json.ts";
import type { Run } from "../bay/runs/runs.ts";
import {
  answer,
  failure,
  finished,
  fixtureRefusal,
  messagesOf,
  notesFlow,
  openedRuns,
  runOf,
  withFlow,
  type Script,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

type Waits = readonly Extract<Run["state"], { readonly status: "waiting" }>["waiting"][];

function waitsOf(run: Run): Waits {
  const state = run.state;
  assert.ok(state.status === "waiting", JSON.stringify(state));
  return [state.waiting, ...(state.alsoWaiting ?? [])];
}

function eachLog(sideBySide: number): Workflow["steps"] {
  return [{ id: "each", foreach: "$trigger", sideBySide, steps: [{ id: "do", action: "log", input: { n: "$item" } }] }];
}

function itemOf(request: ScriptRequest): number {
  return numberField(request.input, "n") ?? -1;
}

type Tally = {
  readonly runsOf: Map<number, number>;
  running: number;
  most: number;
};

function tallied(tally: Tally, body: (item: number) => Promise<ReturnType<typeof finished>>): Script {
  return async (request) => {
    const item = itemOf(request);
    tally.runsOf.set(item, (tally.runsOf.get(item) ?? 0) + 1);
    tally.running += 1;
    tally.most = Math.max(tally.most, tally.running);
    const outcome = await body(item);
    tally.running -= 1;
    return outcome;
  };
}

function newTally(): Tally {
  return { runsOf: new Map(), running: 0, most: 0 };
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("side-by-side items run at the same time up to the cap, and the output keeps item order", async () => {
  const tally = newTally();
  const finishedOrder: number[] = [];
  const log = tallied(tally, async (item) => {
    await pause(item === 0 ? 60 : 10);
    finishedOrder.push(item);
    return finished({ n: item });
  });
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes: withFlow(eachLog(2)) });
  const run = runOf(await runs.start(flow, [0, 1, 2, 3]));
  assert.deepEqual(run.state, { status: "done", output: [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }] });
  assert.equal(tally.most, 2);
  assert.notDeepEqual(finishedOrder, [0, 1, 2, 3]);
  assert.deepEqual(
    run.steps.filter((step) => step.kind === "action").map((step) => step.key),
    ["each[0].do", "each[1].do", "each[2].do", "each[3].do"],
  );
  close();
});

test("a foreach without sideBySide still runs its items one after another", async () => {
  const tally = newTally();
  const log = tallied(tally, async (item) => {
    await pause(5);
    return finished({ n: item });
  });
  const steps: Workflow["steps"] = [
    { id: "each", foreach: "$trigger", steps: [{ id: "do", action: "log", input: { n: "$item" } }] },
  ];
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes: withFlow(steps) });
  const run = runOf(await runs.start(flow, [0, 1, 2]));
  assert.equal(run.state.status, "done");
  assert.equal(tally.most, 1);
  close();
});

test("when items fail, the others run to their end, every failure is named, and the owner is asked", async () => {
  const tally = newTally();
  const failing = new Set([0, 2]);
  const log = tallied(tally, async (item) => {
    await pause(item === 3 ? 30 : 5);
    return failing.has(item) ? failure(`item ${String(item)} broke`) : finished({ n: item });
  });
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes: withFlow(eachLog(2)) });
  const started = runOf(await runs.start(flow, [0, 1, 2, 3]));
  const sentence = "Step each failed for 2 of 4 items: item 0 (each[0]): item 0 broke; item 2 (each[2]): item 2 broke";
  assert.deepEqual(started.state, {
    status: "waiting",
    waiting: {
      reason: "owner",
      stepKey: "each",
      question: `${sentence} Resume with --rerun to run the failed items again, or stop the run.`,
    },
  });
  assert.deepEqual([...tally.runsOf.entries()].sort(), [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  assert.deepEqual(runOf(await runs.show(started.id)).state, started.state);
  const again = runOf(await runs.resume(started.id));
  assert.equal(again.state.status, "waiting");
  assert.equal(tally.runsOf.get(0), 1);
  failing.clear();
  const rerun = runOf(await runs.resume(started.id, { rerun: true }));
  assert.deepEqual(rerun.state, { status: "done", output: [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }] });
  assert.deepEqual([...tally.runsOf.entries()].sort(), [
    [0, 2],
    [1, 1],
    [2, 2],
    [3, 1],
  ]);
  assert.deepEqual(
    rerun.steps.filter((step) => step.kind === "action").map((step) => [step.key, step.status]),
    [
      ["each[0].do", "failed"],
      ["each[1].do", "done"],
      ["each[2].do", "failed"],
      ["each[3].do", "done"],
      ["each[0]~2.do", "done"],
      ["each[2]~2.do", "done"],
    ],
  );
  close();
});

test("stopping a run whose side-by-side items failed fails it with every failure named", async () => {
  const log: Script = (request) => (itemOf(request) === 1 ? failure("item 1 broke") : finished({ n: itemOf(request) }));
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes: withFlow(eachLog(3)) });
  const started = runOf(await runs.start(flow, [0, 1, 2]));
  const stopped = runOf(await runs.stop(started.id));
  assert.ok(stopped.state.status === "undone", JSON.stringify(stopped.state));
  assert.equal(stopped.state.reason, "Step each failed for 1 of 3 items: item 1 (each[1]): item 1 broke");
  close();
});

const draftEach: Workflow["steps"] = [
  {
    id: "each",
    foreach: "$trigger",
    sideBySide: 2,
    steps: [{ id: "write", action: "draft", input: { topic: "$item" } }],
  },
];

function skillTokenOf(waiting: Waits[number] | undefined): string {
  assert.ok(waiting?.reason === "skill", JSON.stringify(waiting));
  const { token } = waiting.task;
  assert.ok(token !== undefined, "the task carries no token");
  return token;
}

test("a run waits on the skill steps of two items at once, each with its own key, task and token", async () => {
  const { runs, close } = await openedRuns({ changes: withFlow(draftEach) });
  const started = runOf(await runs.start(flow, ["tea", "coffee"]));
  const waits = waitsOf(started);
  assert.deepEqual(
    waits.map((waiting) => [waiting.stepKey, waiting.reason === "skill" ? waiting.task.input : null]),
    [
      ["each[0].write/0#1", { topic: "tea" }],
      ["each[1].write/0#1", { topic: "coffee" }],
    ],
  );
  const first = skillTokenOf(waits[0]);
  const second = skillTokenOf(waits[1]);
  assert.notEqual(first, second);
  const listed = (await runs.list())[0];
  assert.ok(listed?.status === "waiting");
  assert.deepEqual(listed.alsoWaiting, [{ waitingFor: "skill", stepKey: "each[1].write/0#1" }]);
  const task = await runs.task(second, "files_read");
  assert.ok(task.ok);
  assert.deepEqual(task.value.input, { topic: "coffee" });
  const afterSecond = runOf(await runs.submit(second, answer({ text: "coffee is long enough" })));
  const left = waitsOf(afterSecond);
  assert.deepEqual(
    left.map((waiting) => [waiting.stepKey, waiting.reason === "skill" ? waiting.task.token : "none"]),
    [["each[0].write/0#1", undefined]],
  );
  assert.match(messagesOf(await runs.submit(second, answer({ text: "again and again" }))), /no longer waiting/);
  const done = runOf(await runs.submit(first, answer({ text: "tea is long enough" })));
  assert.deepEqual(done.state, {
    status: "done",
    output: [{ text: "tea is long enough" }, { text: "coffee is long enough" }],
  });
  close();
});

test("a new token for one step's task leaves the other item's token working", async () => {
  const { runs, close } = await openedRuns({ changes: withFlow(draftEach) });
  const started = runOf(await runs.start(flow, ["tea", "coffee"]));
  const [first, second] = waitsOf(started);
  assert.ok(first?.reason === "skill" && second?.reason === "skill");
  const renewed = runOf(await runs.reissueTask(started.id, first.stepKey));
  const [renewedFirst, renewedSecond] = waitsOf(renewed);
  assert.ok(renewedFirst?.reason === "skill" && renewedSecond?.reason === "skill");
  assert.equal(renewedSecond.task.token, undefined);
  assert.ok(renewedFirst.task.token !== undefined && renewedFirst.task.token !== first.task.token);
  assert.match(
    messagesOf(await runs.submit(first.task.token ?? "", answer({ text: "long enough text" }))),
    /not valid/,
  );
  const kept = runOf(await runs.submit(second.task.token ?? "", answer({ text: "coffee is long enough" })));
  assert.equal(waitsOf(kept).length, 1);
  close();
});

test("the hook's sighting for one item's skill step is never taken for the other item's", async () => {
  const seen: string[] = [];
  const hook = {
    config: () =>
      Promise.resolve({
        ok: true as const,
        value: { bindings: {}, adapter: "local", skillSteps: { run: "with-the-hook" as const } },
      }),
    saw: (_adapter: string, handedIn: { readonly token: string }) => Promise.resolve(seen.includes(handedIn.token)),
  };
  const { runs, close } = await openedRuns({ changes: withFlow(draftEach), hook });
  const started = runOf(await runs.start(flow, ["tea", "coffee"]));
  const [first, second] = waitsOf(started);
  assert.ok(first?.reason === "skill" && second?.reason === "skill");
  seen.push(first.task.token ?? "");
  const refused = messagesOf(await runs.submit(second.task.token ?? "", answer({ text: "coffee is long enough" })));
  assert.match(refused, /did not see the agent of skill draft of mode notes hand it in with this task's token/);
  assert.match(refused, /still waits for step each\[1\]\.write\/0#1/);
  const taken = runOf(await runs.submit(first.task.token ?? "", answer({ text: "tea is long enough" })));
  assert.deepEqual(
    waitsOf(taken).map((waiting) => waiting.stepKey),
    ["each[1].write/0#1"],
  );
  const notes = taken.events.filter((event) => event.kind === "skill.hook").map((event) => event.detail);
  assert.deepEqual(notes, [{ stepKey: "each[0].write/0#1", hookSaw: true, skillSteps: "with-the-hook" }]);
  close();
});

test("two items' approvals wait at once, and each is answered by its own step key and hash", async () => {
  const steps: Workflow["steps"] = [
    {
      id: "each",
      foreach: "$trigger",
      sideBySide: 2,
      steps: [{ id: "keep", approval: "Keep this item?", show: "$item" }],
    },
  ];
  const { runs, close } = await openedRuns({ changes: withFlow(steps) });
  const started = runOf(await runs.start(flow, ["a", "b"]));
  const [first, second] = waitsOf(started);
  assert.ok(first?.reason === "approval" && second?.reason === "approval");
  assert.deepEqual([first.stepKey, second.stepKey], ["each[0].keep", "each[1].keep"]);
  const wrong = await runs.approve(started.id, {
    stepKey: "each[1].keep",
    hash: first.hash,
    verdict: "approve",
    by: "me",
  });
  assert.match(messagesOf(wrong), /is not the hash of what step each\[1\]\.keep showed/);
  const one = runOf(
    await runs.approve(started.id, { stepKey: "each[1].keep", hash: second.hash, verdict: "approve", by: "me" }),
  );
  assert.deepEqual(
    waitsOf(one).map((waiting) => waiting.stepKey),
    ["each[0].keep"],
  );
  const both = runOf(
    await runs.approve(started.id, { stepKey: "each[0].keep", hash: first.hash, verdict: "approve", by: "me" }),
  );
  assert.deepEqual(both.state, { status: "done", output: ["a", "b"] });
  close();
});

test("a budget that only one of two side-by-side items fits runs one, and the other waits for budget", async () => {
  const tally = newTally();
  const spend = tallied(tally, async (item) => {
    await pause(10);
    return finished({ measure: "usd", n: item }, { usd: 1 });
  });
  const steps: Workflow["steps"] = [
    {
      id: "each",
      foreach: "$trigger",
      sideBySide: 2,
      steps: [{ id: "pay", action: "spend", input: { measure: "usd", n: "$item" } }],
    },
  ];
  const changes = { ...withFlow(steps), config: { budget: { usd: 0.5 } } };
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/spend.ts": spend }, changes });
  const started = runOf(await runs.start(flow, [0, 1]));
  assert.equal(tally.most, 1);
  assert.deepEqual([...tally.runsOf.entries()], [[0, 1]]);
  assert.deepEqual(started.spent.usd, 1);
  const waits = waitsOf(started);
  assert.deepEqual(
    waits.map((waiting) => [waiting.reason, waiting.stepKey]),
    [
      ["budget", "each[0].pay/1"],
      ["budget", "each[1].pay/0"],
    ],
  );
  assert.deepEqual(runOf(await runs.show(started.id)).state, started.state);
  close();
});

test("a script's time limit is its own step's under side-by-side items, not shared by the foreach", async () => {
  const limits: number[] = [];
  const log: Script = (request) => {
    limits.push(request.timeLimitMilliseconds);
    return finished(request.input);
  };
  const notesActions = {
    log: {
      description: "When a test logs.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["write" as const],
      run: [{ script: "scripts/log.ts" }],
      scriptTimeLimitSeconds: 30,
    },
  };
  const changes = { ...withFlow(eachLog(3)), notesActions };
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/log.ts": log }, changes });
  assert.equal(runOf(await runs.start(flow, [0, 1, 2])).state.status, "done");
  assert.deepEqual(limits, [30_000, 30_000, 30_000]);
  close();
});

test("a kept call under one side-by-side item stays packed", async () => {
  const probe: Script = async (request) => {
    const stored = await request.call("items-store.put", request.input);
    return stored.status === "done" ? finished({ kept: true }) : failure(stored.reason);
  };
  const notesActions = {
    keep: {
      description: "When a test keeps an item and its calls packed.",
      input: "schemas/item.json",
      output: "schemas/anything.json",
      effects: ["read" as const, "write" as const],
      run: [{ script: "scripts/probe.ts" }],
      calledOutputs: "kept-packed" as const,
    },
  };
  const steps: Workflow["steps"] = [
    { id: "each", foreach: "$trigger", sideBySide: 2, steps: [{ id: "put", action: "keep", input: { id: "$item" } }] },
  ];
  const changes = { ...withFlow(steps), notesActions };
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/probe.ts": probe }, changes });
  const run = runOf(await runs.start(flow, ["apple", "pear"]));
  assert.deepEqual(run.state, { status: "done", output: [{ kept: true }, { kept: true }] });
  const kept = run.steps.filter((step) => step.kept === "kept-packed").map((step) => step.key);
  assert.deepEqual(kept.sort(), [
    "each[0].put/0.call0",
    "each[0].put/0.call0/0",
    "each[1].put/0.call0",
    "each[1].put/0.call0/0",
  ]);
  const shown = JSON.stringify(run.steps.filter((step) => step.kept === "kept-packed"));
  assert.ok(!shown.includes("apple") && !shown.includes("pear"));
  close();
});

test("bay check refuses a sideBySide outside 2 to 8", async () => {
  for (const sideBySide of [1, 9]) {
    const problems = await fixtureRefusal(withFlow(eachLog(sideBySide)));
    assert.ok(
      problems.some((problem) => problem.includes("sideBySide")),
      JSON.stringify(problems),
    );
  }
});

test("waiting items' keys are shown in the run's steps under the item they belong to", async () => {
  const { runs, close } = await openedRuns({ changes: withFlow(draftEach) });
  const started = runOf(await runs.start(flow, ["tea", "coffee"]));
  const keys = started.steps.map((step) => step.key).sort();
  assert.deepEqual(keys, ["each", "each[0].write", "each[0].write/0", "each[1].write", "each[1].write/0"]);
  const skillStep = started.steps.find((step) => step.key === "each[1].write/0");
  assert.equal(textField(skillStep?.detail ?? null, "skill"), "skills/draft");
  close();
});
