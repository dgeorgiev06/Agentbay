import { join } from "node:path/posix";
import {
  measures,
  type EventSink,
  type Json,
  type Permissions,
  type PolicyOf,
  type RunEvent,
  type Scrubber,
  type ScriptRunner,
  type SkillTask,
  type Spend,
  type StepPlace,
  type Submission,
  type Tier,
} from "../contracts.ts";
import type { Budget } from "../generated/mode.ts";
import { fieldOf, numberField, textField, toJson } from "../json.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import type { Clock, FileSystem, Folders } from "../ports.ts";
import type { System } from "../registry.ts";
import { Engine } from "./engine.ts";
import {
  kernelDatabaseFile,
  runStatuses,
  type RunWithSteps,
  type StepRecord,
  type WaitingReason,
} from "./run-store.ts";
import type { RunView, UndoEntry, UndoReport, Waiting } from "./run-state.ts";
import { scrubbedStore } from "./scrubbed-store.ts";
import { SqliteRunStore } from "./sqlite-run-store.ts";
import { skillRoundOf } from "./step-key.ts";
import { checkTaskToken, issueTaskToken } from "./task-tokens.ts";
import { calledTarget, storedWaiting } from "./waiting.ts";

export type RunsNeeds = {
  readonly project: string;
  readonly folders: Folders;
  readonly files: FileSystem;
  readonly clock: Clock;
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly scrubber: Scrubber;
  readonly runner: (events: EventSink) => ScriptRunner;
  readonly toolCallsPerRound: number;
};

export type Task = {
  readonly runId: string;
  readonly stepKey: string;
  readonly round: number;
  readonly feedback: readonly string[];
  readonly skill: string;
  readonly tier: Tier;
  readonly input: Json;
  readonly files: { readonly skill: string; readonly outputSchema: string; readonly alsoMatches: readonly string[] };
  readonly place: StepPlace;
  readonly permissions: Permissions;
  readonly toolCalls: number;
  readonly token?: string;
};

type RunWaiting =
  | Exclude<Waiting, { readonly reason: "skill" }>
  | { readonly reason: "skill"; readonly stepKey: string; readonly task: Task };

type RunStep = {
  readonly key: string;
  readonly kind: string;
  readonly startedAt: string;
  readonly input: Json;
  readonly detail: Json;
} & (
  | { readonly status: "started" }
  | { readonly status: "done"; readonly finishedAt: string; readonly output: Json }
  | { readonly status: "failed"; readonly finishedAt: string; readonly reason: string }
);

export type Run = {
  readonly id: string;
  readonly target: { readonly kind: "action" | "workflow"; readonly mode: string; readonly name: string };
  readonly state:
    | { readonly status: "running" }
    | { readonly status: "waiting"; readonly waiting: RunWaiting }
    | { readonly status: "done"; readonly output: Json }
    | { readonly status: "failed"; readonly reason: string }
    | { readonly status: "undone"; readonly reason: string; readonly undo: UndoReport };
  readonly spent: Spend;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly askedBy?: { readonly runId: string; readonly stepKey: string };
  readonly steps: readonly RunStep[];
  readonly events: readonly RunEvent[];
};

export type RunSummary = Pick<Run, "id" | "target" | "createdAt" | "updatedAt"> & {
  readonly status: Run["state"]["status"];
  readonly waitingFor?: WaitingReason;
  readonly stepKey?: string;
};

type Start = { readonly action: string } | { readonly workflow: { readonly mode: string; readonly path: string } };

type Decision = {
  readonly stepKey: string;
  readonly hash: string;
  readonly verdict: "approve" | "reject";
  readonly by: string;
};

type Called = { readonly output: Json; readonly runId: string };

export type Runs = {
  readonly start: (what: Start, input: Json) => Promise<Outcome<Run>>;
  readonly show: (runId: string) => Promise<Outcome<Run>>;
  readonly list: () => Promise<readonly RunSummary[]>;
  readonly approve: (runId: string, decision: Decision) => Promise<Outcome<Run>>;
  readonly resume: (runId: string, options?: { readonly rerun: boolean }) => Promise<Outcome<Run>>;
  readonly extend: (runId: string, extra: Budget) => Promise<Outcome<Run>>;
  readonly stop: (runId: string) => Promise<Outcome<Run>>;
  readonly wakeDue: () => Promise<readonly Outcome<Run>[]>;
  readonly reissueTask: (runId: string) => Promise<Outcome<Run>>;
  readonly task: (token: string, tool: string) => Promise<Outcome<Task>>;
  readonly submit: (token: string, submission: Submission) => Promise<Outcome<Run>>;
  readonly callAction: (token: string, action: string, input: Json) => Promise<Outcome<Called>>;
  readonly events: EventSink;
  readonly close: () => void;
  readonly agentTools: { readonly engine: Engine; readonly store: SqliteRunStore };
};

type Opened = {
  readonly needs: RunsNeeds;
  readonly store: SqliteRunStore;
  readonly engine: Engine;
  readonly events: EventSink;
};

type Showing = {
  readonly waiting: Waiting | undefined;
  readonly issue: (waitingKey: string) => boolean;
};

type Stored = {
  readonly run: RunWithSteps;
  readonly events: readonly RunEvent[];
};

const askedByKind = "run.asked-by";

const toolCalledKind = "tool.called";

const shownOnly: Showing = { waiting: undefined, issue: () => false };

function refusal(message: string, fix?: string): Outcome<never> {
  return failedWith([unplacedProblem(message, fix)]);
}

function stepOf(record: StepRecord): RunStep {
  const { key, kind, startedAt, input, detail } = record;
  const base = { key, kind, startedAt, input, detail };
  switch (record.status) {
    case "started":
      return { ...base, status: record.status };
    case "done":
      return { ...base, status: record.status, finishedAt: record.finishedAt, output: record.output };
    case "failed":
      return { ...base, status: record.status, finishedAt: record.finishedAt, reason: record.reason };
  }
}

function undoEntriesOf(undo: Json, list: keyof UndoReport): readonly (UndoEntry & { readonly reason: string })[] {
  const entries = fieldOf(undo, list);
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((element: unknown) => {
    const entry = toJson(element);
    const stepKey = textField(entry, "stepKey");
    const action = textField(entry, "action");
    const reason = textField(entry, "reason") ?? "";
    return stepKey === undefined || action === undefined ? [] : [{ stepKey, action, reason }];
  });
}

function undoReportOf(undo: Json): UndoReport {
  const plain = (list: keyof UndoReport): readonly UndoEntry[] =>
    undoEntriesOf(undo, list).map(({ stepKey, action }) => ({ stepKey, action }));
  return {
    undone: plain("undone"),
    failed: undoEntriesOf(undo, "failed"),
    noUndo: plain("noUndo"),
    deleteNotUndone: plain("deleteNotUndone"),
  };
}

function budgetWaitingOf(events: readonly RunEvent[], stepKey: string): Waiting | undefined {
  const exceeded = events.findLast(
    (event) => event.kind === "budget.exceeded" && textField(event.detail, "stepKey") === stepKey,
  );
  const detail = exceeded?.detail ?? null;
  const measure = measures.find((known) => known === textField(detail, "measure"));
  const limit = numberField(detail, "limit");
  const spent = numberField(detail, "spent");
  if (measure === undefined || limit === undefined || spent === undefined) {
    return undefined;
  }
  return { reason: "budget", stepKey, overrun: { measure, limit, spent } };
}

function toolCallsAt(events: readonly RunEvent[], waitingKey: string): number {
  return events.filter((event) => event.kind === toolCalledKind && textField(event.detail, "stepKey") === waitingKey)
    .length;
}

function taskOf(opened: Opened, stored: Stored, waiting: { readonly stepKey: string; readonly task: SkillTask }): Task {
  const { task, stepKey } = waiting;
  const folder = opened.needs.system.modes.get(task.place.mode)?.folder ?? "";
  return {
    runId: task.place.runId,
    stepKey,
    round: task.round,
    feedback: task.feedback,
    skill: task.skill,
    tier: task.tier,
    input: task.input,
    files: {
      skill: join(folder, task.skill, "SKILL.md"),
      outputSchema: task.outputSchema === "" ? "" : join(folder, task.outputSchema),
      alsoMatches: task.alsoMatches.map((schema) => join(folder, schema)),
    },
    place: task.place,
    permissions: task.permissions,
    toolCalls: toolCallsAt(stored.events, stepKey),
  };
}

async function waitingOf(opened: Opened, stored: Stored, showing: Showing): Promise<RunWaiting | string> {
  const { run, events } = stored;
  const state = run.state;
  const stepKey = state.status === "waiting" ? state.stepKey : "";
  const waiting = showing.waiting ?? storedWaiting(opened.needs, run) ?? budgetWaitingOf(events, stepKey);
  if (waiting === undefined) {
    return `Run ${run.id} waits at step ${stepKey}, but kernel.db does not hold what the step waits for.`;
  }
  if (waiting.reason !== "skill") {
    return waiting;
  }
  const task = taskOf(opened, stored, waiting);
  if (!showing.issue(waiting.stepKey)) {
    return { ...waiting, task };
  }
  const place = { runId: run.id, stepKey: waiting.stepKey, round: task.round };
  const token = await issueTaskToken(opened.store, place, opened.needs.clock.now());
  return { ...waiting, task: { ...task, token } };
}

async function stateOf(opened: Opened, stored: Stored, showing: Showing): Promise<Run["state"] | string> {
  const state = stored.run.state;
  switch (state.status) {
    case "running":
    case "done":
    case "failed":
      return state;
    case "undone":
      return { ...state, undo: undoReportOf(state.undo) };
    case "waiting": {
      const waiting = await waitingOf(opened, stored, showing);
      return typeof waiting === "string" ? waiting : { status: state.status, waiting };
    }
  }
}

function askedByOf(events: readonly RunEvent[]): Pick<Run, "askedBy"> {
  const detail = events.find((event) => event.kind === askedByKind)?.detail ?? null;
  const runId = textField(detail, "runId");
  const stepKey = textField(detail, "stepKey");
  return runId === undefined || stepKey === undefined ? {} : { askedBy: { runId, stepKey } };
}

async function shownRun(opened: Opened, runId: string, showing: Showing): Promise<Outcome<Run>> {
  const run = await opened.store.readRun(runId);
  if (run === undefined) {
    return refusal(`There is no run ${runId}.`, "bay runs lists the runs.");
  }
  const events = await opened.store.readEvents(runId);
  const state = await stateOf(opened, { run, events }, showing);
  if (typeof state === "string") {
    return refusal(state);
  }
  const { id, target, spent, createdAt, updatedAt } = run;
  return succeededWith({
    id,
    target: { kind: target.kind, mode: target.mode, name: target.name },
    state,
    spent,
    createdAt,
    updatedAt,
    ...askedByOf(events),
    steps: run.steps.map(stepOf),
    events,
  });
}

function resultOf(opened: Opened, result: Outcome<RunView>, issue: Showing["issue"]): Promise<Outcome<Run>> {
  if (!result.ok) {
    return Promise.resolve(result);
  }
  const state = result.value.state;
  const waiting = state.status === "waiting" ? state.waiting : undefined;
  return shownRun(opened, result.value.id, { waiting, issue });
}

async function changed(opened: Opened, runId: string, change: () => Promise<Outcome<RunView>>): Promise<Outcome<Run>> {
  const state = (await opened.store.readRun(runId))?.state;
  const before = state?.status === "waiting" && state.reason === "skill" ? state.stepKey : undefined;
  return resultOf(opened, await change(), (waitingKey) => waitingKey !== before);
}

function sameStep(waitingKey: string, submittedKey: string): boolean {
  const step = skillRoundOf(submittedKey)?.step;
  return step !== undefined && skillRoundOf(waitingKey)?.step === step;
}

async function submitted(opened: Opened, token: string, submission: Submission): Promise<Outcome<Run>> {
  const place = await checkTaskToken({ tokens: opened.store, runs: opened.store }, token);
  if (!place.ok) {
    return place;
  }
  const { runId, stepKey } = place.value;
  const result = await opened.engine.submit(runId, stepKey, submission);
  return resultOf(opened, result, (waitingKey) => sameStep(waitingKey, stepKey));
}

async function taskOfToken(opened: Opened, token: string): Promise<Outcome<Task>> {
  const place = await checkTaskToken({ tokens: opened.store, runs: opened.store }, token);
  if (!place.ok) {
    return place;
  }
  const run = await shownRun(opened, place.value.runId, shownOnly);
  if (!run.ok) {
    return run;
  }
  const state = run.value.state;
  if (state.status !== "waiting" || state.waiting.reason !== "skill") {
    return refusal(`Run ${run.value.id} does not wait for a skill.`);
  }
  return succeededWith(state.waiting.task);
}

async function toolTask(opened: Opened, token: string, tool: string): Promise<Outcome<Task>> {
  const found = await taskOfToken(opened, token);
  if (!found.ok) {
    return found;
  }
  const task = found.value;
  const limit = opened.needs.toolCallsPerRound;
  if (tool !== "submit" && task.toolCalls >= limit) {
    return refusal(
      `This round of step ${task.stepKey} has used its ${String(limit)} tool calls. ` +
        "Submit your output now with submit; only submit still works in this round.",
    );
  }
  const at = opened.needs.clock.now().toISOString();
  await opened.events.append({ at, runId: task.runId, kind: toolCalledKind, detail: { tool, stepKey: task.stepKey } });
  return succeededWith({ ...task, toolCalls: task.toolCalls + 1 });
}

function calledOf(result: Outcome<RunView>, action: string): Outcome<Called> {
  if (!result.ok) {
    return result;
  }
  const state = result.value.state;
  switch (state.status) {
    case "done":
      return succeededWith({ output: state.output, runId: result.value.id });
    case "failed":
    case "undone":
      return refusal(`The action ${action} failed: ${state.reason}`);
    case "waiting":
      return refusal(
        `The action ${action} stopped to wait for ${state.waiting.reason} (run ${result.value.id}); ` +
          "an action called from a skill must finish without waiting.",
      );
  }
}

async function calledAction(
  opened: Opened,
  token: string,
  call: { action: string; input: Json },
): Promise<Outcome<Called>> {
  const found = await taskOfToken(opened, token);
  if (!found.ok) {
    return found;
  }
  const { action, input } = call;
  const task = found.value;
  const target = calledTarget(opened.needs.system, task.place.mode, action);
  if (typeof target === "string") {
    return refusal(target);
  }
  const effects = target.action.effects;
  if (effects.some((effect) => effect !== "read")) {
    return refusal(
      `The action ${action} has the effects ${effects.join(", ")}; a skill may call only actions whose effects ` +
        "are read only.",
    );
  }
  const caller = action.includes(".") ? { caller: task.place.mode } : {};
  const reference = `${target.mode.manifest.name}.${target.name}`;
  const result = await opened.engine.startForSkill({
    runId: task.runId,
    stepKey: task.stepKey,
    reference,
    input,
    ...caller,
  });
  if (result.ok) {
    const at = opened.needs.clock.now().toISOString();
    const detail = { runId: task.runId, stepKey: task.stepKey };
    await opened.events.append({ at, runId: result.value.id, kind: askedByKind, detail });
  }
  return calledOf(result, action);
}

async function summaries(store: SqliteRunStore): Promise<readonly RunSummary[]> {
  const listed = [];
  for (const status of runStatuses) {
    listed.push(...(await store.listRuns(status)));
  }
  listed.sort((first, second) => second.createdAt.localeCompare(first.createdAt) || second.id.localeCompare(first.id));
  return listed.map((run) => {
    const { id, target, createdAt, updatedAt, state } = run;
    const waiting = state.status === "waiting" ? { waitingFor: state.reason, stepKey: state.stepKey } : {};
    const shownTarget = { kind: target.kind, mode: target.mode, name: target.name };
    return { id, target: shownTarget, createdAt, updatedAt, status: state.status, ...waiting };
  });
}

function started(opened: Opened, what: Start, input: Json): Promise<Outcome<RunView>> {
  return "action" in what
    ? opened.engine.startAction(what.action, input)
    : opened.engine.startWorkflow(what.workflow, input);
}

function runsOf(opened: Opened): Runs {
  const { engine, store, events, needs } = opened;
  const always = (): boolean => true;
  return {
    start: async (what, input) => resultOf(opened, await started(opened, what, input), always),
    show: (runId) => shownRun(opened, runId, shownOnly),
    list: () => summaries(store),
    approve: (runId, decision) => {
      const { stepKey, hash, verdict, by } = decision;
      return changed(opened, runId, () => engine.approve(runId, stepKey, { hash, decision: verdict, by }));
    },
    resume: (runId, options) =>
      changed(opened, runId, () => engine.resume(runId, { rerunUnfinished: options?.rerun ?? false })),
    extend: (runId, extra) => changed(opened, runId, () => engine.extendBudget(runId, extra)),
    stop: (runId) => changed(opened, runId, () => engine.stop(runId)),
    wakeDue: async () => {
      const woken = await engine.tick(needs.clock.now());
      return Promise.all(woken.map((result) => resultOf(opened, result, shownOnly.issue)));
    },
    reissueTask: (runId) => shownRun(opened, runId, { waiting: undefined, issue: always }),
    task: (token, tool) => toolTask(opened, token, tool),
    submit: (token, submission) => submitted(opened, token, submission),
    callAction: (token, action, input) => calledAction(opened, token, { action, input }),
    events,
    close: () => {
      store.close();
    },
    agentTools: { engine, store },
  };
}

export async function openRuns(needs: RunsNeeds): Promise<Runs> {
  const store = await SqliteRunStore.open(needs.folders, join(needs.project, kernelDatabaseFile));
  const scrubbed = scrubbedStore(store, needs.scrubber);
  const events: EventSink = { append: scrubbed.append };
  const { system, policyOf, clock, files, scrubber } = needs;
  const runner = needs.runner(events);
  const engine = new Engine({ system, store, runner, policyOf, clock, files, scrubber });
  return runsOf({ needs, store, engine, events });
}
