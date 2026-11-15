import { join } from "node:path/posix";
import { agentName } from "./adapter.ts";
import type { Json, RunEvent, SkillTask } from "./contracts.ts";
import { byteSize, textField, toJson } from "./json.ts";
import type { Kernel } from "./kernel.ts";
import type { RunWithSteps, StepRecord, StoredRun, StoredState } from "./run-store.ts";
import type { RunView, Waiting } from "./run-state.ts";
import type { Outcome } from "./outcome.ts";
import { skillNameOf } from "./skill-tools.ts";
import { issueTaskToken } from "./task-tokens.ts";
import { askedByKind } from "./tools.ts";
import { storedWaiting } from "./waiting.ts";
import { problemsResult, type CommandResult, type JsonObject } from "./command-context.ts";
import { shownProblems } from "./layout.ts";

export type TokenChoice = "issue" | "replace" | "withhold";

export type ReportOptions = {
  readonly token?: TokenChoice;
  readonly waiting?: Waiting;
  readonly full?: boolean;
  readonly events?: boolean;
  readonly steps?: boolean;
};

export type RunReport = {
  readonly json: JsonObject;
  readonly text: string;
};

const tokenNotices: { readonly [Choice in TokenChoice]: (runId: string) => string } = {
  issue: () => "A task token was issued with this task; it is shown only now.",
  replace: () => "A new task token was issued; the token shown earlier for this task no longer works.",
  withhold: (runId) =>
    `The token was shown when this task was issued. bay runs ${runId} --new-token replaces it with a new one.`,
};

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
  readonly token: string | undefined;
  readonly runId: string;
  readonly stepKey: string;
  readonly skillFile: string;
  readonly input: Json;
  readonly outputSchema: string;
  readonly alsoMatches: readonly string[];
  readonly round: number;
  readonly feedback: readonly string[];
};

type TaskRequest = {
  readonly task: SkillTask;
  readonly waitingKey: string;
  readonly token: TokenChoice;
};

async function taskOf(kernel: Kernel, request: TaskRequest): Promise<Task> {
  const { task, waitingKey } = request;
  const folder = kernel.system.modes.get(task.place.mode)?.folder ?? "";
  const place = { runId: task.place.runId, stepKey: waitingKey, round: task.round };
  const token =
    request.token === "withhold" ? undefined : await issueTaskToken(kernel.store, place, kernel.ports.clock.now());
  return {
    agent: agentName(task.place.mode, skillNameOf(task.skill)),
    token,
    runId: task.place.runId,
    stepKey: waitingKey,
    skillFile: join(folder, task.skill, "SKILL.md"),
    input: task.input,
    outputSchema: task.outputSchema === "" ? "" : join(folder, task.outputSchema),
    alsoMatches: task.alsoMatches.map((schema) => join(folder, schema)),
    round: task.round,
    feedback: task.feedback,
  };
}

function taskJson(task: Task): JsonObject {
  const { token, alsoMatches, ...rest } = task;
  const also = alsoMatches.length === 0 ? {} : { alsoMatches: [...alsoMatches] };
  return { ...rest, ...also, ...(token === undefined ? {} : { token }), feedback: [...task.feedback] };
}

function askedByOf(events: readonly RunEvent[]): Json | undefined {
  return events.find((event) => event.kind === askedByKind)?.detail;
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
  readonly events: readonly RunEvent[];
  readonly options: ReportOptions;
};

function noticeOf(gathered: Gathered): string {
  return tokenNotices[gathered.options.token ?? "withhold"](gathered.run.id);
}

function reportJson(gathered: Gathered): JsonObject {
  const { run, waiting, task, events, options } = gathered;
  const steps = run.steps.map((step) => stepJson(step, options.full ?? false));
  const askedBy = askedByOf(events);
  return {
    id: run.id,
    target: { kind: run.target.kind, mode: run.target.mode, name: run.target.name },
    ...stateJson(run.state),
    spent: { ...run.spent },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(waiting === undefined ? {} : { waiting: waitingJson(waiting) }),
    ...(task === undefined ? {} : { task: taskJson(task), notice: noticeOf(gathered) }),
    ...(askedBy === undefined ? {} : { askedBy }),
    ...(options.steps === true ? { steps } : {}),
    ...(options.events === true ? { events: events.map(eventJson) } : {}),
  };
}

function reportText(gathered: Gathered): string {
  const { run, waiting, task, events, options } = gathered;
  const lines = [
    `run ${run.id} (${targetText(run)}): ${stateLine(run.state)}`,
    outcomeText(run.state),
    waiting === undefined ? "" : waitingText(run, waiting),
    askedByText(askedByOf(events)),
    task === undefined ? "" : `task for the agent ${task.agent}. ${noticeOf(gathered)}\n${pretty(taskJson(task))}`,
    options.steps === true ? stepsText(run.steps) : "",
    options.events === true ? eventsText(events) : "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function askedByText(askedBy: Json | undefined): string {
  if (askedBy === undefined) {
    return "";
  }
  const step = textField(askedBy, "stepKey") ?? "";
  return `asked for by step ${step} of run ${textField(askedBy, "runId") ?? ""} (call_action)`;
}

async function reportRun(kernel: Kernel, run: RunWithSteps, options: ReportOptions = {}): Promise<RunReport> {
  const waiting = options.waiting ?? storedWaiting(kernel, run);
  const token = options.token ?? "withhold";
  const task =
    waiting?.reason === "skill"
      ? await taskOf(kernel, { task: waiting.task, waitingKey: waiting.stepKey, token })
      : undefined;
  const events = await kernel.store.readEvents(run.id);
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

export async function skillWaitOf(kernel: Kernel, runId: string): Promise<string | undefined> {
  const state = (await kernel.store.readRun(runId))?.state;
  return state?.status === "waiting" && state.reason === "skill" ? state.stepKey : undefined;
}

export async function engineOutput(
  kernel: Kernel,
  result: Outcome<RunView>,
  skillWaitBefore: string | undefined,
): Promise<CommandResult> {
  if (!result.ok) {
    return problemsResult(shownProblems(kernel.layout, result.problems));
  }
  const state = result.value.state;
  if (state.status !== "waiting") {
    return runOutput(kernel, result.value.id);
  }
  const waiting = state.waiting;
  const entered = waiting.reason === "skill" && waiting.stepKey !== skillWaitBefore;
  return runOutput(kernel, result.value.id, { waiting, token: entered ? "issue" : "withhold" });
}
