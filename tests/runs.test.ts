import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventSink, Json } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import {
  answer,
  crashingOnce,
  finished,
  messagesOf,
  notesFlow,
  openedRuns,
  runOf,
  secretValue,
  tokenOf,
  waitingTask,
  withFlow,
  type Opening,
  type Script,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

const good = answer({ text: "long enough to pass" });

test("openRuns opens kernel.db owner-only before it builds the runner, whose events reach the run scrubbed", async () => {
  const said: EventSink[] = [];
  const scripts: Record<string, Script> = {
    "notes:scripts/log.ts": async (request) => {
      await said[0]?.append({ at: "now", runId: request.place.runId, kind: "script.said", detail: secretValue });
      return finished(request.input);
    },
  };
  const { runs, database, createdBeforeRunner, sink, close } = await openedRuns({ scripts });
  said.push(sink());
  assert.deepEqual(createdBeforeRunner, [database]);
  const run = runOf(await runs.start({ action: "notes.log" }, { note: "hi" }));
  const event = run.events.find((entry) => entry.kind === "script.said");
  assert.equal(event?.detail, "[redacted:NOTES_TOKEN]");
  close();
});

test("start runs an action or a workflow to its end, and refuses an unknown action", async () => {
  const { runs, close } = await openedRuns(withFlowOpening([{ id: "seed", action: "copy", input: { count: 1 } }]));
  const action = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
  assert.deepEqual(action.state, { status: "done", output: { count: 5 } });
  assert.deepEqual(action.target, { kind: "action", mode: "notes", name: "copy" });
  assert.deepEqual(
    action.steps.map((step) => [step.key, step.status]),
    [
      ["0", "done"],
      ["1", "done"],
      ["2", "done"],
    ],
  );
  const workflow = runOf(await runs.start(flow, null));
  assert.deepEqual(workflow.target, { kind: "workflow", mode: "notes", name: "workflows/flow.yaml" });
  assert.deepEqual(workflow.state, { status: "done", output: { count: 5 } });
  assert.match(messagesOf(await runs.start({ action: "notes.nothing" }, {})), /Mode notes has no action nothing/);
  close();
});

function withFlowOpening(steps: Workflow["steps"]): Opening {
  return { changes: withFlow(steps) };
}

test("start that waits for a skill hands over its task with a token; show gives the same run without one", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, { topic: "tea" }));
  const task = waitingTask(started);
  assert.equal(task.stepKey, "0#1");
  assert.equal(task.round, 1);
  assert.equal(task.files.skill, "/kit/components/modes/notes/skills/draft/SKILL.md");
  assert.equal(task.files.outputSchema, "/kit/components/modes/notes/schemas/draft.json");
  assert.deepEqual(task.input, { topic: "tea" });
  assert.equal(typeof task.token, "string");
  const shown = runOf(await runs.show(started.id));
  assert.equal(waitingTask(shown).token, undefined);
  const { token, ...untokened } = task;
  assert.ok(token !== undefined);
  assert.deepEqual(shown.state, { status: "waiting", waiting: { reason: "skill", stepKey: "0#1", task: untokened } });
  assert.deepEqual(messagesOf(await runs.show("nowhere")), "There is no run nowhere.");
  close();
});

test("list gives every run newest first, with what a waiting run waits for", async () => {
  const { runs, clock, close } = await openedRuns();
  const done = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
  clock.advance(1000);
  const waiting = runOf(await runs.start({ action: "notes.draft" }, {}));
  const listed = await runs.list();
  assert.deepEqual(
    listed.map((run) => [run.id, run.status, ...(run.status === "waiting" ? [run.waitingFor, run.stepKey] : [])]),
    [
      [waiting.id, "waiting", "skill", "0#1"],
      [done.id, "done"],
    ],
  );
  assert.deepEqual(listed[1]?.target, { kind: "action", mode: "notes", name: "copy" });
  close();
});

test("approve continues a run for the hash it showed and refuses another hash", async () => {
  const steps: Workflow["steps"] = [
    { id: "seed", action: "copy", input: { count: "$trigger" } },
    { id: "keep", approval: "Keep this count?", show: "$steps.seed.output" },
  ];
  const { runs, close } = await openedRuns(withFlowOpening(steps));
  const started = runOf(await runs.start(flow, 1));
  const state = started.state;
  assert.ok(state.status === "waiting" && state.waiting.reason === "approval");
  assert.deepEqual(state.waiting.content, { count: 5 });
  const decision = { stepKey: "keep", verdict: "approve", by: "owner" } as const;
  const wrong = await runs.approve(started.id, { ...decision, hash: "not-it" });
  assert.match(messagesOf(wrong), /is not the hash of what step keep showed/);
  const approved = runOf(await runs.approve(started.id, { ...decision, hash: state.waiting.hash }));
  assert.deepEqual(approved.state, { status: "done", output: { count: 5 } });
  close();
});

test("resume at the same skill wait issues no token and the old one still works", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const token = tokenOf(started);
  const resumed = runOf(await runs.resume(started.id));
  assert.equal(waitingTask(resumed).token, undefined);
  assert.equal(waitingTask(resumed).stepKey, "0#1");
  assert.ok((await runs.task(token, "db_query")).ok);
  close();
});

test("resume at the same skill wait counts the tool calls the round has already made, as show does", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const token = tokenOf(started);
  assert.ok((await runs.task(token, "db_query")).ok);
  assert.ok((await runs.task(token, "files_read")).ok);
  const resumed = runOf(await runs.resume(started.id));
  assert.equal(waitingTask(resumed).toolCalls, 2);
  assert.equal(waitingTask(runOf(await runs.show(started.id))).toolCalls, 2);
  close();
});

test("resume that brings a run into a skill wait it was not in issues a token", async () => {
  const prepared = {
    input: "schemas/anything.json",
    output: "schemas/draft.json",
    effects: ["read" as const],
    run: [{ script: "scripts/slow.ts" }, { skill: "skills/draft", tier: "fast" as const }],
  };
  const scripts = { "notes:scripts/slow.ts": crashingOnce((request) => finished(request.input)) };
  const { runs, close } = await openedRuns({ scripts, changes: { notesActions: { prepared } } });
  assert.match(messagesOf(await runs.start({ action: "notes.prepared" }, {})), /the process died/);
  const id = (await runs.list())[0]?.id ?? "";
  assert.equal(runOf(await runs.show(id)).state.status, "running");
  const resumed = runOf(await runs.resume(id));
  assert.equal(waitingTask(resumed).stepKey, "1#1");
  assert.ok((await runs.task(tokenOf(resumed), "db_query")).ok);
  close();
});

test("resume with rerun runs again a step with effects that did not finish", async () => {
  const { runs, close } = await openedRuns({
    scripts: { "notes:scripts/log.ts": crashingOnce((request) => finished(request.input)) },
  });
  assert.match(messagesOf(await runs.start({ action: "notes.log" }, { note: 1 })), /the process died/);
  const id = (await runs.list())[0]?.id ?? "";
  const asked = runOf(await runs.resume(id));
  assert.ok(asked.state.status === "waiting" && asked.state.waiting.reason === "owner");
  assert.equal(asked.state.waiting.stepKey, "0");
  const rerun = runOf(await runs.resume(id, { rerun: true }));
  assert.deepEqual(rerun.state, { status: "done", output: { note: 1 } });
  close();
});

test("extend continues a run that waits for budget, and show gives the same overrun the start gave", async () => {
  const { runs, close } = await openedRuns({ changes: { config: { budget: { items: 2 } } } });
  const started = runOf(await runs.start({ action: "notes.budgeted" }, { id: "b1", measure: "items" }));
  const state = started.state;
  assert.ok(state.status === "waiting" && state.waiting.reason === "budget");
  assert.deepEqual(state.waiting.overrun, { measure: "items", limit: 1, spent: 2 });
  assert.deepEqual(runOf(await runs.show(started.id)).state, state);
  const little = runOf(await runs.extend(started.id, { items: 0 }));
  assert.equal(little.state.status, "waiting");
  const extended = runOf(await runs.extend(started.id, { items: 10 }));
  assert.equal(extended.state.status, "done");
  close();
});

test("an extend too small for the step waits again there, and show gives the new overrun, not the first", async () => {
  const { runs, close } = await openedRuns({ changes: { config: { budget: { usd: 1.5 } } } });
  const started = runOf(await runs.start({ action: "notes.spend" }, { measure: "usd" }));
  const first = {
    status: "waiting",
    waiting: { reason: "budget", stepKey: "2", overrun: { measure: "usd", limit: 1.5, spent: 2 } },
  };
  assert.deepEqual(started.state, first);
  const little = runOf(await runs.extend(started.id, { usd: 0.25 }));
  const again = {
    status: "waiting",
    waiting: { reason: "budget", stepKey: "2", overrun: { measure: "usd", limit: 1.75, spent: 2 } },
  };
  assert.deepEqual(little.state, again);
  assert.deepEqual(runOf(await runs.show(started.id)).state, again);
  close();
});

test("stop ends a waiting run, and an ended run refuses to be stopped again", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const stopped = runOf(await runs.stop(started.id));
  assert.deepEqual(stopped.state, { status: "failed", reason: "The owner stopped the run." });
  assert.match(messagesOf(await runs.stop(started.id)), /has ended \(failed\)/);
  close();
});

test("wakeDue wakes only runs whose wait is due, by the runs' own clock", async () => {
  const steps: Workflow["steps"] = [
    { id: "pause", wait: "2h" },
    { id: "after", action: "copy", input: { count: 0 } },
  ];
  const { runs, clock, close } = await openedRuns(withFlowOpening(steps));
  const started = runOf(await runs.start(flow, null));
  const state = started.state;
  assert.ok(state.status === "waiting" && state.waiting.reason === "time");
  assert.deepEqual(await runs.wakeDue(), []);
  clock.advance(2 * 60 * 60 * 1000);
  const woken = await runs.wakeDue();
  assert.deepEqual(
    woken.map((result) => runOf(result).state),
    [{ status: "done", output: { count: 3 } }],
  );
  close();
});

test("reissueTask gives the task a new token and the old one stops working", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const first = tokenOf(started);
  const second = tokenOf(runOf(await runs.reissueTask(started.id)));
  assert.notEqual(first, second);
  assert.match(messagesOf(await runs.task(first, "db_query")), /The token is not valid/);
  assert.ok((await runs.task(second, "db_query")).ok);
  close();
});

test("task checks the token, counts each read tool call of the round and refuses past the limit except submit", async () => {
  const { runs, close } = await openedRuns({ toolCallsPerRound: 2 });
  const started = runOf(await runs.start({ action: "notes.draft" }, { topic: "tea" }));
  const token = tokenOf(started);
  const first = await runs.task(token, "db_query");
  assert.ok(first.ok);
  assert.equal(first.value.toolCalls, 1);
  assert.equal(first.value.stepKey, "0#1");
  assert.deepEqual(first.value.place, { runId: started.id, mode: "notes", action: "draft", stepKey: "0" });
  const second = await runs.task(token, "files_read");
  assert.equal(second.ok ? second.value.toolCalls : 0, 2);
  assert.match(messagesOf(await runs.task(token, "db_query")), /has used its 2 tool calls/);
  assert.ok((await runs.task(token, "submit")).ok);
  const called = runOf(await runs.show(started.id)).events.filter((event) => event.kind === "tool.called");
  assert.deepEqual(
    called.map((event) => event.detail),
    [
      { tool: "db_query", stepKey: "0#1" },
      { tool: "files_read", stepKey: "0#1" },
    ],
  );
  assert.match(messagesOf(await runs.task("made-up", "db_query")), /The token is not valid/);
  close();
});

test("callAction counts against the round's limit with no task before it, and submit is never refused", async () => {
  const { runs, close } = await openedRuns({ toolCallsPerRound: 2 });
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const token = tokenOf(started);
  assert.ok((await runs.callAction(token, "items-store.get", { id: "a" })).ok);
  assert.ok((await runs.callAction(token, "items-store.get", { id: "b" })).ok);
  const third = await runs.callAction(token, "items-store.get", { id: "c" });
  assert.match(messagesOf(third), /This round of step 0#1 has used its 2 tool calls/);
  const retry = runOf(await runs.submit(token, answer({ text: "short" })));
  const called = runOf(await runs.show(started.id)).events.filter((event) => event.kind === "tool.called");
  assert.deepEqual(
    called.map((event) => event.detail),
    [
      { tool: "call_action", stepKey: "0#1" },
      { tool: "call_action", stepKey: "0#1" },
      { tool: "submit", stepKey: "0#1" },
    ],
  );
  const next = tokenOf(retry);
  assert.ok((await runs.task(next, "db_query")).ok);
  assert.ok((await runs.callAction(next, "items-store.get", { id: "d" })).ok);
  assert.match(messagesOf(await runs.callAction(next, "items-store.get", { id: "e" })), /0#2 has used its 2/);
  assert.match(messagesOf(await runs.task(next, "files_read")), /0#2 has used its 2 tool calls/);
  const done = runOf(await runs.submit(next, good));
  assert.equal(done.state.status, "done");
  close();
});

test("submit gives the next round of the same step a token, and ends the run on a good output", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const retry = runOf(await runs.submit(tokenOf(started), answer({ text: "short" })));
  const task = waitingTask(retry);
  assert.equal(task.stepKey, "0#2");
  assert.deepEqual(task.feedback, ["too short: short"]);
  const done = runOf(await runs.submit(tokenOf(retry), good));
  assert.deepEqual(done.state, { status: "done", output: { text: "long enough to pass" } });
  assert.match(messagesOf(await runs.submit(tokenOf(retry), good)), /no longer waiting/);
  close();
});

test("a submitter never receives the token of another skill step", async () => {
  const steps: Workflow["steps"] = [
    { id: "first", action: "draft" },
    { id: "second", action: "draft" },
  ];
  const { runs, close } = await openedRuns(withFlowOpening(steps));
  const started = runOf(await runs.start(flow, {}));
  assert.equal(waitingTask(started).stepKey, "first/0#1");
  const next = runOf(await runs.submit(tokenOf(started), good));
  assert.equal(waitingTask(next).stepKey, "second/0#1");
  assert.equal(waitingTask(next).token, undefined);
  const reissued = runOf(await runs.reissueTask(next.id));
  assert.ok((await runs.task(tokenOf(reissued), "db_query")).ok);
  close();
});

test("callAction runs a read-only action for the skill, records who asked, and refuses other effects", async () => {
  const { runs, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const token = tokenOf(started);
  const called = await runs.callAction(token, "items-store.get", { id: "a" });
  assert.ok(called.ok, JSON.stringify(called));
  assert.deepEqual(called.value.output, { id: "a" });
  const child = runOf(await runs.show(called.value.runId));
  assert.deepEqual(child.askedBy, { runId: started.id, stepKey: "0#1" });
  assert.deepEqual(child.target, { kind: "action", mode: "store", name: "get" });
  const own = await runs.callAction(token, "copy", { count: 1 });
  assert.deepEqual(own.ok ? own.value.output : null, { count: 5 });
  const writing = await runs.callAction(token, "items-store.put", { id: "a" });
  assert.match(messagesOf(writing), /has the effects write; a skill may call only actions whose effects are read/);
  const saving = await runs.callAction(token, "save", { count: 1 });
  assert.match(messagesOf(saving), /has the effects read, write; a skill may call only actions/);
  assert.match(messagesOf(await runs.callAction("made-up", "copy", {})), /The token is not valid/);
  close();
});

test("callAction runs the action as the skill's mode, held to what the calling run has left, and charges it", async () => {
  const scripts: Record<string, Script> = {
    "store:scripts/get.ts": (request) => finished({ caller: request.caller ?? null }, { items: 2 }),
  };
  const { runs, close } = await openedRuns({ scripts, changes: { config: { budget: { items: 3 } } } });
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const token = tokenOf(started);
  const first = await runs.callAction(token, "items-store.get", {});
  assert.deepEqual(first.ok ? first.value.output : null, { caller: "notes" });
  assert.equal(runOf(await runs.show(started.id)).spent.items, 2);
  const second = await runs.callAction(token, "items-store.get", {});
  assert.match(messagesOf(second), /The action items-store.get stopped to wait for budget/);
  close();
});

test("events appends to the run, and close leaves the runs for the next openRuns on the project", async () => {
  const { runs, reopen, close } = await openedRuns();
  const started = runOf(await runs.start({ action: "notes.draft" }, {}));
  const detail: Json = { said: `the token is ${secretValue}` };
  await runs.events.append({ at: "now", runId: started.id, kind: "owner.said", detail });
  runs.close();
  const again = await reopen();
  const shown = runOf(await again.show(started.id));
  assert.deepEqual(shown.events.find((event) => event.kind === "owner.said")?.detail, {
    said: "the token is [redacted:NOTES_TOKEN]",
  });
  assert.equal(waitingTask(shown).stepKey, "0#1");
  close();
});

test("a run that fails after a step with effects is undone, and the run says what was undone", async () => {
  const { runs, close } = await openedRuns();
  const run = runOf(await runs.start({ action: "notes.store-then-fail" }, { id: "x" }));
  assert.deepEqual(run.state, {
    status: "undone",
    reason: "the script gave up",
    undo: { undone: [{ stepKey: "0", action: "store.put" }], failed: [], noUndo: [], deleteNotUndone: [] },
  });
  assert.deepEqual(runOf(await runs.show(run.id)).state, run.state);
  close();
});
