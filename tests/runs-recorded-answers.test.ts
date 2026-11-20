import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { numberField, textField } from "../bay/json.ts";
import type { Run, Runs } from "../bay/runs/runs.ts";
import {
  answer,
  eventKinds,
  finished,
  messagesOf,
  notesFlow,
  openedRuns,
  runOf,
  secretValue,
  withFlow,
  type OpenedRuns,
  type Script,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

const check = "notes:scripts/long-enough.ts";

type Gate = {
  readonly script: Script;
  readonly reached: Promise<undefined>;
  readonly open: () => void;
};

type Waits = readonly Extract<Run["state"], { readonly status: "waiting" }>["waiting"][];

function drafts(sideBySide: number): Workflow["steps"] {
  return [
    {
      id: "each",
      foreach: "$trigger",
      sideBySide,
      steps: [{ id: "write", action: "draft", input: { topic: "$item" } }],
    },
  ];
}

function gateOn(topic: string): Gate {
  const reached = Promise.withResolvers<undefined>();
  const held = Promise.withResolvers<undefined>();
  const script: Script = async (request: ScriptRequest) => {
    const text = textField(request.input, "text") ?? "";
    if (text.startsWith(topic)) {
      reached.resolve(undefined);
      await held.promise;
    }
    return finished(text.length >= 10 ? { passed: true } : { passed: false, feedback: `too short: ${text}` });
  };
  const open = (): void => {
    held.resolve(undefined);
  };
  return { script, reached: reached.promise, open };
}

function waitsOf(run: Run): Waits {
  const state = run.state;
  assert.ok(state.status === "waiting", JSON.stringify(state));
  return [state.waiting, ...(state.alsoWaiting ?? [])];
}

function tokensOf(run: Run): readonly string[] {
  return waitsOf(run).map((waiting) => {
    assert.ok(waiting.reason === "skill" && waiting.task.token !== undefined, JSON.stringify(waiting));
    return waiting.task.token;
  });
}

function checkKeys(run: Run): readonly string[] {
  return run.steps.filter((step) => step.kind === "check").map((step) => step.key);
}

function said(text: string): ReturnType<typeof answer> {
  return answer({ text });
}

type Advancing = {
  readonly opened: OpenedRuns;
  readonly gate: Gate;
  readonly started: Run;
  readonly tokens: readonly string[];
  readonly first: Promise<ReturnType<typeof runOf>>;
  readonly other: Runs;
};

async function whileTeaAdvances(topics: readonly string[]): Promise<Advancing> {
  const gate = gateOn("tea");
  const opened = await openedRuns({ scripts: { [check]: gate.script }, changes: withFlow(drafts(topics.length)) });
  const started = runOf(await opened.runs.start(flow, topics));
  const tokens = tokensOf(started);
  const first = opened.runs.submit(tokens[0] ?? "", said("tea is long enough")).then(runOf);
  await gate.reached;
  const other = await opened.reopen();
  return { opened, gate, started, tokens, first, other };
}

test("a submit that arrives while another call advances the run is recorded, and taken once when that call ends", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee"]);
  const recorded = runOf(await other.submit(tokens[1] ?? "", said("coffee is long enough")));
  assert.equal(recorded.state.status, "running");
  assert.deepEqual(recorded.recordedAnswers, ["each[1].write/0#1"]);
  assert.equal(eventKinds(recorded).filter((kind) => kind === "answer.recorded").length, 1);
  gate.open();
  const done = await first;
  assert.deepEqual(done.state, {
    status: "done",
    output: [{ text: "tea is long enough" }, { text: "coffee is long enough" }],
  });
  assert.equal(done.recordedAnswers, undefined);
  assert.deepEqual(checkKeys(done), ["each[0].write/0#1.check0", "each[1].write/0#1.check0"]);
  assert.equal(opened.runner.runsOf(check).length, 2);
  opened.close();
});

test("a second submit for a step whose answer is recorded is refused, and so is one after it was taken", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee"]);
  const coffee = tokens[1] ?? "";
  runOf(await other.submit(coffee, said("coffee is long enough")));
  const again = messagesOf(await other.submit(coffee, said("coffee, a second time")));
  assert.match(again, /already has a submission for each\[1\]\.write\/0#1; it is applied once/);
  gate.open();
  const done = await first;
  assert.deepEqual(done.state.status, "done");
  assert.match(messagesOf(await other.submit(coffee, said("coffee, a third time"))), /no longer waiting for it/);
  assert.equal(opened.runner.runsOf(check).length, 2);
  opened.close();
});

test("a submit refused while the run advances keeps its token for the corrected answer", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee"]);
  const coffee = tokens[1] ?? "";
  assert.match(messagesOf(await other.submit(coffee, said(""))), /output.text must not be empty/);
  assert.match(messagesOf(await other.submit(coffee, answer({ text: "x" }, { usd: -1 }))), /spend is not valid/);
  const task = await other.task(coffee, "submit");
  assert.ok(task.ok, JSON.stringify(task));
  assert.deepEqual(task.value.input, { topic: "coffee" });
  assert.deepEqual(runOf(await other.submit(coffee, said("coffee is long enough"))).recordedAnswers, [
    "each[1].write/0#1",
  ]);
  gate.open();
  assert.equal((await first).state.status, "done");
  opened.close();
});

test("two submits for two steps that arrive together while a third advances are both taken, each once", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee", "milk"]);
  const third = await opened.reopen();
  const both = await Promise.all([
    other.submit(tokens[1] ?? "", said("coffee is long enough")),
    third.submit(tokens[2] ?? "", said("milk is long enough")),
  ]);
  assert.deepEqual(
    both.map((result) => runOf(result).state.status),
    ["running", "running"],
  );
  assert.deepEqual([...(runOf(both[1]).recordedAnswers ?? [])].sort(), ["each[1].write/0#1", "each[2].write/0#1"]);
  gate.open();
  const done = await first;
  assert.deepEqual(done.state, {
    status: "done",
    output: [{ text: "tea is long enough" }, { text: "coffee is long enough" }, { text: "milk is long enough" }],
  });
  assert.deepEqual(checkKeys(done), [
    "each[0].write/0#1.check0",
    "each[1].write/0#1.check0",
    "each[2].write/0#1.check0",
  ]);
  opened.close();
});

test("an answer that fails its checks after it was recorded gets the next round with feedback", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee"]);
  runOf(await other.submit(tokens[1] ?? "", said("coffee")));
  gate.open();
  const after = await first;
  const [coffee] = waitsOf(after);
  assert.ok(coffee?.reason === "skill");
  assert.deepEqual(
    [coffee.stepKey, coffee.task.feedback, coffee.task.token],
    ["each[1].write/0#2", ["too short: coffee"], undefined],
  );
  opened.close();
});

type Stranded = {
  readonly opened: OpenedRuns;
  readonly id: string;
  readonly coffee: string;
};

async function strandedAnswer(): Promise<Stranded> {
  const opened = await openedRuns({ changes: withFlow(drafts(2)) });
  const started = runOf(await opened.runs.start(flow, ["tea", "coffee"]));
  const database = new DatabaseSync(opened.database);
  database
    .prepare("update runs set lock_owner = ?, lock_heartbeat = ? where id = ?")
    .run("engine-that-died", opened.clock.now().toISOString(), started.id);
  database.close();
  const coffee = tokensOf(started)[1] ?? "";
  const recorded = runOf(await opened.runs.submit(coffee, said("coffee is long enough")));
  assert.deepEqual(recorded.recordedAnswers, ["each[1].write/0#1"]);
  assert.match(messagesOf(await opened.runs.resume(started.id)), /being advanced by engine-that-died/);
  opened.clock.advance(11 * 60_000);
  return { opened, id: started.id, coffee };
}

test("an answer recorded while a dead engine held the run is taken at the next advance", async () => {
  const { opened, id } = await strandedAnswer();
  const resumed = runOf(await opened.runs.resume(id));
  assert.equal(resumed.recordedAnswers, undefined);
  assert.deepEqual(
    waitsOf(resumed).map((waiting) => waiting.stepKey),
    ["each[0].write/0#1"],
  );
  const coffeeStep = resumed.steps.find((step) => step.key === "each[1].write/0");
  assert.ok(coffeeStep?.status === "done");
  assert.deepEqual(coffeeStep.output, { text: "coffee is long enough" });
  opened.close();
});

test("an answer recorded for a run that is stopped before it is taken is dropped, and the reason is an event", async () => {
  const { opened, id } = await strandedAnswer();
  const stopped = runOf(await opened.runs.stop(id));
  assert.ok(stopped.state.status === "undone" || stopped.state.status === "failed", JSON.stringify(stopped.state));
  assert.equal(stopped.recordedAnswers, undefined);
  const dropped = stopped.events.find((event) => event.kind === "answer.dropped");
  assert.equal(textField(dropped?.detail ?? null, "stepKey"), "each[1].write/0#1");
  assert.match(textField(dropped?.detail ?? null, "reason") ?? "", /has ended/);
  assert.equal(opened.runner.runsOf(check).length, 0);
  opened.close();
});

test("a submit that kernel.db cannot take in time is refused with a reason, and its token still works", async () => {
  const opened = await openedRuns({ changes: withFlow(drafts(2)) });
  const started = runOf(await opened.runs.start(flow, ["tea", "coffee"]));
  const [tea] = tokensOf(started);
  const blocker = new DatabaseSync(opened.database);
  blocker.exec("begin immediate");
  const refused = messagesOf(await opened.runs.submit(tea ?? "", said("tea is long enough")));
  blocker.exec("rollback");
  blocker.close();
  assert.match(refused, /the answer was not recorded; its token still works/);
  const taken = runOf(await opened.runs.submit(tea ?? "", said("tea is long enough")));
  assert.deepEqual(
    waitsOf(taken).map((waiting) => waiting.stepKey),
    ["each[1].write/0#1"],
  );
  opened.close();
});

test("while the run advances, a made-up token and the advancing step's own token are refused", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee"]);
  const [tea = "", coffee = ""] = tokens;
  assert.match(messagesOf(await other.submit(`${coffee}x`, said("coffee is long enough"))), /The token is not valid/);
  assert.match(
    messagesOf(await other.submit(tea, said("tea, a second time"))),
    /already has a submission for each\[0\]\.write\/0#1/,
  );
  gate.open();
  assert.deepEqual(
    waitsOf(await first).map((waiting) => waiting.stepKey),
    ["each[1].write/0#1"],
  );
  assert.equal(runOf(await other.submit(coffee, said("coffee is long enough"))).state.status, "done");
  opened.close();
});

test("a recorded answer is scrubbed before kernel.db keeps it", async () => {
  const { opened, gate, tokens, first, other } = await whileTeaAdvances(["tea", "coffee"]);
  runOf(await other.submit(tokens[1] ?? "", said(`coffee and ${secretValue}`)));
  const database = new DatabaseSync(opened.database, { readOnly: true });
  const kept = JSON.stringify(database.prepare("select * from answers").all());
  database.close();
  assert.ok(kept.includes("coffee and") && !kept.includes(secretValue), kept);
  gate.open();
  await first;
  opened.close();
});

async function roundOf(runs: Runs, runId: string, key: string): Promise<number | undefined> {
  const step = runOf(await runs.show(runId)).steps.find((each) => each.key === key);
  return numberField(step?.detail ?? null, "round");
}

test("while the run advances, an answer with the step key of a round the step has left is refused", async () => {
  const gate = gateOn("coffee");
  const opened = await openedRuns({ scripts: { [check]: gate.script }, changes: withFlow(drafts(2)) });
  const started = runOf(await opened.runs.start(flow, ["tea", "coffee"]));
  const [tea = "", coffee = ""] = tokensOf(started);
  const database = new DatabaseSync(opened.database);
  database
    .prepare("update runs set lock_owner = ?, lock_heartbeat = ? where id = ?")
    .run("engine-that-died", opened.clock.now().toISOString(), started.id);
  database.close();
  runOf(await opened.runs.submit(tea, said("tea")));
  runOf(await opened.runs.submit(coffee, said("coffee is long enough")));
  opened.clock.advance(11 * 60_000);
  const resuming = opened.runs.resume(started.id);
  await gate.reached;
  const other = await opened.reopen();
  while ((await roundOf(other, started.id, "each[0].write/0")) !== 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const late = messagesOf(await other.submit(tea, said("tea, now long enough")));
  assert.match(late, /already has a submission for each\[0\]\.write\/0#1/);
  gate.open();
  assert.deepEqual(
    waitsOf(runOf(await resuming)).map((waiting) => waiting.stepKey),
    ["each[0].write/0#2"],
  );
  opened.close();
});
