import { join } from "node:path/posix";
import { agentName } from "./adapter.ts";
import type { Json, RunEvent, SkillTask } from "./contracts.ts";
import { byteSize, toJson } from "./json.ts";
import type { Kernel } from "./kernel.ts";
import type { RunWithSteps, StepRecord, StoredRun, StoredState } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { skillNameOf } from "./skill-tools.ts";
import { issueTaskToken } from "./task-tokens.ts";
import { storedWaiting } from "./waiting.ts";
import { problemsResult, type CommandResult, type JsonObject } from "./command-context.ts";
import type { EngineResult } from "./run-state.ts";

export type ReportOptions = {
  readonly waiting?: Waiting;
  readonly full?: boolean;
  readonly events?: boolean;
  readonly steps?: boolean;
};

export type RunReport = {
  readonly json: JsonObject;
  readonly text: string;
};

const tokenNotice = "A new task token was issued with this task; any token shown earlier for this run no longer works.";

function targetText(run: StoredRun): string {
  return `${run.target.kind} ${run.target.mode}${run.target.kind === "action" ? "." : ":"}${run.target.name}`;
}

function stateJson(state: StoredState): JsonObject {
  switch (state.status) {
    case "running":
      return { status: state.status };
    case "waiting":
      return { status: state.status, waitingFor: state.reason, stepKey: state.stepKey };
    case "done":
      return { status: state.status, output: state.output };
    case "failed":
      return { status: state.status, reason: state.reason };
    case "undone":
      return { status: state.status, reason: state.reason, undo: state.undo };
  }
}

function stateLine(state: StoredState): string {
  switch (state.status) {
    case "waiting":
      return `waiting for ${state.reason} at ${state.stepKey}`;
    case "running":
    case "done":
    case "failed":
    case "undone":
      return state.status;
  }
}

function waitingJson(waiting: Waiting): JsonObject {
  switch (waiting.reason) {
    case "skill":
      return { reason: waiting.reason, stepKey: waiting.stepKey };
    case "approval":
      return {
        reason: waiting.reason,
        stepKey: waiting.stepKey,
        question: waiting.question,
        hash: waiting.hash,
        content: waiting.content,
        ...(waiting.previousHash === undefined ? {} : { previousHash: waiting.previousHash }),
      };
    case "time":
      return { reason: waiting.reason, stepKey: waiting.stepKey, until: waiting.until };
    case "budget":
      return { reason: waiting.reason, stepKey: waiting.stepKey, overrun: toJson(waiting.overrun) };
    case "owner":
      return { reason: waiting.reason, stepKey: waiting.stepKey, question: waiting.question };
  }
}

function pretty(value: Json): string {
  return JSON.stringify(value, null, 2);
}

function waitingText(run: StoredRun, waiting: Waiting): string {
  switch (waiting.reason) {
    case "skill":
      return "";
    case "approval":
      return [
        `approval: ${waiting.question}`,
        `shown content (hash ${waiting.hash}):`,
        pretty(waiting.content),
        `decide with: bay approve ${run.id} ${waiting.stepKey} --hash ${waiting.hash} [--reject]`,
      ].join("\n");
    case "time":
      return `wakes at ${waiting.until}; bay resume --due wakes it then`;
    case "budget":
      return `the budget is spent: ${pretty(toJson(waiting.overrun))}`;
    case "owner":
      return `${waiting.question}\nresume with: bay resume ${run.id} --rerun`;
  }
}

type Task = {
  readonly agent: string;
  readonly token: string;
  readonly runId: string;
  readonly stepKey: string;
  readonly skillFile: string;
  readonly input: Json;
  readonly outputSchema: string;
  readonly round: number;
  readonly feedback: readonly string[];
};

async function taskOf(kernel: Kernel, task: SkillTask, waitingKey: string): Promise<Task> {
  const folder = kernel.system.modes.get(task.place.mode)?.folder ?? "";
  const place = { runId: task.place.runId, stepKey: waitingKey, round: task.round };
  const token = await issueTaskToken(kernel.store, place, kernel.ports.clock.now());
  return {
    agent: agentName(task.place.mode, skillNameOf(task.skill)),
    token,
    runId: task.place.runId,
    stepKey: waitingKey,
    skillFile: join(folder, task.skill, "SKILL.md"),
    input: task.input,
    outputSchema: task.outputSchema === "" ? "" : join(folder, task.outputSchema),
    round: task.round,
    feedback: task.feedback,
  };
}

function taskJson(task: Task): JsonObject {
  return { ...task, feedback: [...task.feedback] };
}

function stepJson(step: StepRecord, full: boolean): JsonObject {
  const base = { key: step.key, kind: step.kind, status: step.status, startedAt: step.startedAt };
  const sizes = { inputBytes: byteSize(step.input) };
  const payload = full ? { input: step.input, detail: step.detail } : sizes;
  switch (step.status) {
    case "started":
      return { ...base, ...payload };
    case "finished":
      return {
        ...base,
        finishedAt: step.finishedAt,
        ...payload,
        ...(full ? { output: step.output } : { outputBytes: byteSize(step.output) }),
      };
    case "failed":
      return { ...base, finishedAt: step.finishedAt, ...payload, reason: step.reason };
  }
}

function eventJson(event: RunEvent): JsonObject {
  return { at: event.at, kind: event.kind, detail: event.detail };
}

function stepsText(steps: readonly StepRecord[]): string {
  return ["steps:", ...steps.map((step) => `  ${step.key}  ${step.kind}  ${step.status}`)].join("\n");
}

function eventsText(events: readonly RunEvent[]): string {
  const lines = events.map((event) => `  ${event.at}  ${event.kind}  ${JSON.stringify(event.detail)}`);
  return ["events:", ...lines].join("\n");
}

function outcomeText(state: StoredState): string {
  switch (state.status) {
    case "done":
      return `output:\n${pretty(state.output)}`;
    case "failed":
    case "undone":
      return `reason: ${state.reason}`;
    case "running":
    case "waiting":
      return "";
  }
}

type Gathered = {
  readonly run: RunWithSteps;
  readonly waiting: Waiting | undefined;
  readonly task: Task | undefined;
  readonly events: readonly RunEvent[] | undefined;
  readonly options: ReportOptions;
};

function reportJson(gathered: Gathered): JsonObject {
  const { run, waiting, task, events, options } = gathered;
  const steps = run.steps.map((step) => stepJson(step, options.full ?? false));
  return {
    id: run.id,
    target: { kind: run.target.kind, mode: run.target.mode, name: run.target.name },
    ...stateJson(run.state),
    spent: { ...run.spent },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(waiting === undefined ? {} : { waiting: waitingJson(waiting) }),
    ...(task === undefined ? {} : { task: taskJson(task), notice: tokenNotice }),
    ...(options.steps === true ? { steps } : {}),
    ...(events === undefined ? {} : { events: events.map(eventJson) }),
  };
}

function reportText(gathered: Gathered): string {
  const { run, waiting, task, events, options } = gathered;
  const lines = [
    `run ${run.id} (${targetText(run)}): ${stateLine(run.state)}`,
    outcomeText(run.state),
    waiting === undefined ? "" : waitingText(run, waiting),
    task === undefined ? "" : `task for the agent ${task.agent}. ${tokenNotice}\n${pretty(taskJson(task))}`,
    options.steps === true ? stepsText(run.steps) : "",
    events === undefined ? "" : eventsText(events),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

async function reportRun(kernel: Kernel, run: RunWithSteps, options: ReportOptions = {}): Promise<RunReport> {
  const waiting = options.waiting ?? storedWaiting(kernel, run);
  const task = waiting?.reason === "skill" ? await taskOf(kernel, waiting.task, waiting.stepKey) : undefined;
  const events = options.events === true ? await kernel.store.readEvents(run.id) : undefined;
  const gathered = { run, waiting, task, events, options };
  return { json: reportJson(gathered), text: reportText(gathered) };
}

export function runLine(run: StoredRun): string {
  return `${run.id}  ${run.createdAt}  ${targetText(run)}  ${stateLine(run.state)}`;
}

export function runListJson(run: StoredRun): JsonObject {
  return {
    id: run.id,
    target: { kind: run.target.kind, mode: run.target.mode, name: run.target.name },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.state.status,
    ...(run.state.status === "waiting" ? { waitingFor: run.state.reason, stepKey: run.state.stepKey } : {}),
  };
}

export async function runOutput(kernel: Kernel, runId: string, options: ReportOptions = {}): Promise<CommandResult> {
  const run = await kernel.store.readRun(runId);
  if (run === undefined) {
    return problemsResult([
      { file: "", path: "", message: `There is no run ${runId}.`, fix: "bay runs lists the runs." },
    ]);
  }
  const report = await reportRun(kernel, run, options);
  const ended = run.state.status === "failed" || run.state.status === "undone";
  return { exitCode: ended ? 1 : 0, json: { ok: !ended, run: report.json }, text: report.text };
}

export async function engineOutput(kernel: Kernel, result: EngineResult): Promise<CommandResult> {
  if (!result.ok) {
    return problemsResult(result.problems);
  }
  const state = result.run.state;
  return runOutput(kernel, result.run.id, state.status === "waiting" ? { waiting: state.waiting } : {});
}
