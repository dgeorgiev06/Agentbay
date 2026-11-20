import { join } from "node:path/posix";
import type { EventSink, Json, RunEvent, Scrubber, ScriptRunner, Spend, Submission } from "../contracts.ts";
import type { Budget, Keeping } from "../generated/mode.ts";
import { fieldOf, isRecord, textField, toJson } from "../json.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import type { Clock, Folders } from "../ports.ts";
import type { System } from "../manifests/manifests.ts";
import { Engine, type AdvancedRun } from "./engine.ts";
import { hookNoteFor, hookNoteKind, type HookWatch } from "./hook-seen.ts";
import { keptInputNote, keptPackedNote, keptReasonNote } from "./packed-output.ts";
import {
  kernelDatabaseFile,
  runStatuses,
  type RunWithSteps,
  type StepRecord,
  type WaitingReason,
} from "./run-store.ts";
import type { RunState, SkillTask, UndoEntry, UndoReport, Waiting } from "./run-state.ts";
import { scrubbedStore } from "./scrubbed-store.ts";
import { toolCalledKind, toolCallsAt } from "./skill-steps.ts";
import { SqliteRunStore } from "./sqlite-run-store.ts";
import { skillRoundOf } from "./step-key.ts";
import { checkTaskToken, issueTaskToken, type TaskPlace } from "./task-tokens.ts";
import { storedWaiting } from "./waiting.ts";

type RunsNeeds = {
  readonly project: string;
  readonly folders: Folders;
  readonly clock: Clock;
  readonly system: System;
  readonly scrubber: Scrubber;
  readonly runner: (events: EventSink) => ScriptRunner;
  readonly toolCallsPerRound: number;
  readonly hook: HookWatch;
};

export type Task = SkillTask & {
  readonly token?: string;
};

type RunStep = {
  readonly key: string;
  readonly kind: string;
  readonly startedAt: string;
  readonly input: Json;
  readonly detail: Json;
  readonly kept?: Keeping;
} & (
  | { readonly status: "started" }
  | { readonly status: "done"; readonly finishedAt: string; readonly output: Json }
  | { readonly status: "failed"; readonly finishedAt: string; readonly reason: string }
);

export type Run = {
  readonly id: string;
  readonly target: { readonly kind: "action" | "workflow"; readonly mode: string; readonly name: string };
  readonly kept?: Keeping;
  readonly state: RunState<Task>;
  readonly spent: Spend;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly askedBy?: { readonly runId: string; readonly stepKey: string };
  readonly steps: readonly RunStep[];
  readonly events: readonly RunEvent[];
};

export type RunSummary = Pick<Run, "id" | "target" | "createdAt" | "updatedAt"> &
  (
    | { readonly status: Exclude<Run["state"]["status"], "waiting"> }
    | { readonly status: "waiting"; readonly waitingFor: WaitingReason; readonly stepKey: string }
  );

type Start = { readonly action: string } | { readonly workflow: { readonly mode: string; readonly path: string } };

type Decision = {
  readonly stepKey: string;
  readonly hash: string;
  readonly by: string;
} & ({ readonly verdict: "approve" | "reject" } | { readonly choice: string });

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

const toolsCountedWhereMade: readonly string[] = ["call_action", "submit"];

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

function withoutSubmission(detail: Json): Json {
  if (!isRecord(detail)) {
    return detail;
  }
  return toJson(Object.fromEntries(Object.entries(detail).filter(([field]) => field !== "submission")));
}

function keptStepOf(step: RunStep): RunStep {
  const input = step.kind === "check" ? keptPackedNote : keptInputNote;
  const kept = { input, detail: withoutSubmission(step.detail), kept: "kept-packed" as const };
  switch (step.status) {
    case "started":
      return { ...step, ...kept };
    case "done":
      return step.kind === "check" ? { ...step, ...kept } : { ...step, ...kept, output: keptPackedNote };
    case "failed":
      return { ...step, ...kept, reason: keptReasonNote };
  }
}

function shownStepOf(record: StepRecord): RunStep {
  const step = stepOf(record);
  return record.kept === "kept-packed" ? keptStepOf(step) : step;
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

async function waitingOf(opened: Opened, stored: Stored, showing: Showing): Promise<Waiting<Task> | string> {
  const { run } = stored;
  const waiting = showing.waiting ?? storedWaiting(opened.needs, stored);
  if (waiting === undefined) {
    const stepKey = run.state.status === "waiting" ? run.state.stepKey : "";
    return `Run ${run.id} waits at step ${stepKey}, but kernel.db does not hold what the step waits for.`;
  }
  if (waiting.reason !== "skill" || !showing.issue(waiting.stepKey)) {
    return waiting;
  }
  const place = { runId: run.id, stepKey: waiting.stepKey, round: waiting.task.round };
  const token = await issueTaskToken(opened.store, place, opened.needs.clock.now());
  return { ...waiting, task: { ...waiting.task, token } };
}

async function stateOf(opened: Opened, stored: Stored, showing: Showing): Promise<RunState<Task> | string> {
  const state = stored.run.state;
  switch (state.status) {
    case "running":
    case "failed":
      return state;
    case "done":
      return stored.run.kept === "kept-packed" ? { status: state.status, output: keptPackedNote } : state;
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
    ...(run.kept === undefined ? {} : { kept: run.kept }),
    state,
    spent,
    createdAt,
    updatedAt,
    ...askedByOf(events),
    steps: run.steps.map(shownStepOf),
    events,
  });
}

function resultOf(opened: Opened, result: Outcome<AdvancedRun>, issue: Showing["issue"]): Promise<Outcome<Run>> {
  if (!result.ok) {
    return Promise.resolve(result);
  }
  const state = result.value.state;
  const waiting = state.status === "waiting" ? state.waiting : undefined;
  return shownRun(opened, result.value.id, { waiting, issue });
}

async function changed(
  opened: Opened,
  runId: string,
  change: () => Promise<Outcome<AdvancedRun>>,
): Promise<Outcome<Run>> {
  const state = (await opened.store.readRun(runId))?.state;
  const before = state?.status === "waiting" && state.reason === "skill" ? state.stepKey : undefined;
  return resultOf(opened, await change(), (waitingKey) => waitingKey !== before);
}

function sameStep(waitingKey: string, submittedKey: string): boolean {
  const step = skillRoundOf(submittedKey)?.step;
  return step !== undefined && skillRoundOf(waitingKey)?.step === step;
}

function placeOf(opened: Opened, token: string): Promise<Outcome<TaskPlace>> {
  return checkTaskToken({ tokens: opened.store, runs: opened.store }, token);
}

async function countedCall(opened: Opened, token: string, tool: string): Promise<Outcome<TaskPlace>> {
  const place = await placeOf(opened, token);
  if (!place.ok) {
    return place;
  }
  const { runId, stepKey } = place.value;
  const used = toolCallsAt(await opened.store.readEvents(runId), stepKey);
  const limit = opened.needs.toolCallsPerRound;
  if (tool !== "submit" && used >= limit) {
    return refusal(
      `This round of step ${stepKey} has used its ${String(limit)} tool calls. ` +
        "Submit your output now with submit; only submit still works in this round.",
    );
  }
  const at = opened.needs.clock.now().toISOString();
  await opened.events.append({ at, runId, kind: toolCalledKind, detail: { tool, stepKey } });
  return place;
}

async function submitted(opened: Opened, token: string, submission: Submission): Promise<Outcome<Run>> {
  const place = await countedCall(opened, token, "submit");
  if (!place.ok) {
    return place;
  }
  const { runId, stepKey } = place.value;
  const task = await taskAt(opened, place.value);
  if (!task.ok) {
    return task;
  }
  const { mode } = task.value.place;
  const note = await hookNoteFor(opened.needs.hook, { runId, stepKey, token, mode, skill: task.value.skill });
  if (!note.ok) {
    return note;
  }
  const at = opened.needs.clock.now().toISOString();
  await opened.events.append({ at, runId, kind: hookNoteKind, detail: note.value });
  const result = await opened.engine.submit(runId, stepKey, submission);
  return resultOf(opened, result, (waitingKey) => sameStep(waitingKey, stepKey));
}

async function taskAt(opened: Opened, place: TaskPlace): Promise<Outcome<Task>> {
  const run = await shownRun(opened, place.runId, shownOnly);
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
  const countedWhereMade = toolsCountedWhereMade.includes(tool);
  const place = countedWhereMade ? await placeOf(opened, token) : await countedCall(opened, token, tool);
  return place.ok ? taskAt(opened, place.value) : place;
}

function calledOf(result: Outcome<AdvancedRun>, action: string): Outcome<Called> {
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
  const place = await countedCall(opened, token, "call_action");
  if (!place.ok) {
    return place;
  }
  const found = await taskAt(opened, place.value);
  if (!found.ok) {
    return found;
  }
  const { runId, stepKey, place: taskPlace } = found.value;
  const { action, input } = call;
  const result = await opened.engine.startForSkill({ runId, stepKey, mode: taskPlace.mode, action, input });
  if (result.ok) {
    const at = opened.needs.clock.now().toISOString();
    await opened.events.append({ at, runId: result.value.id, kind: askedByKind, detail: { runId, stepKey } });
  }
  return calledOf(result, action);
}

async function summaries(store: SqliteRunStore): Promise<readonly RunSummary[]> {
  const listed = [];
  for (const status of runStatuses) {
    listed.push(...(await store.listRuns(status)));
  }
  listed.sort((first, second) => second.createdAt.localeCompare(first.createdAt) || second.id.localeCompare(first.id));
  return listed.map((run): RunSummary => {
    const { id, createdAt, updatedAt, state } = run;
    const target = { kind: run.target.kind, mode: run.target.mode, name: run.target.name };
    if (state.status !== "waiting") {
      return { id, target, createdAt, updatedAt, status: state.status };
    }
    return { id, target, createdAt, updatedAt, status: state.status, waitingFor: state.reason, stepKey: state.stepKey };
  });
}

function started(opened: Opened, what: Start, input: Json): Promise<Outcome<AdvancedRun>> {
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
      const { stepKey, hash, by } = decision;
      const answer =
        "choice" in decision
          ? { decision: "choice" as const, choice: decision.choice }
          : {
              decision: decision.verdict,
            };
      return changed(opened, runId, () => engine.approve(runId, stepKey, { hash, by, ...answer }));
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
  };
}

export async function openRuns(needs: RunsNeeds): Promise<Runs> {
  const store = await SqliteRunStore.open(needs.folders, join(needs.project, kernelDatabaseFile));
  const scrubbed = scrubbedStore(store, needs.scrubber);
  const events: EventSink = { append: scrubbed.append };
  const { system, clock, scrubber } = needs;
  const runner = needs.runner(events);
  const engine = new Engine({ system, store, runner, clock, scrubber });
  return runsOf({ needs, store, engine, events });
}
