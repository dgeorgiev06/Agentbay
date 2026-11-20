import { agentName } from "./adapter.ts";
import type { RunEvent } from "./contracts.ts";
import { byteSize, toJson } from "./json.ts";
import type { Run, RunSummary, Task } from "./runs/runs.ts";
import { skillNameOf } from "./skill-tools.ts";
import type { Outcome } from "./outcome.ts";
import { problemsResult, type CommandResult, type JsonObject } from "./command-context.ts";
import { shownProblems, type Layout } from "./layout.ts";
import {
  noticeOf,
  pretty,
  stateLine,
  statusLine,
  alsoWaitingIn,
  taskIn,
  waitingIn,
  waitingJson,
  waitingText,
  type ReportOptions,
} from "./waiting-report.ts";

type State = Run["state"];

type Step = Run["steps"][number];

type Waiting = Extract<State, { readonly status: "waiting" }>["waiting"];

function targetText(target: Run["target"]): string {
  return `${target.kind} ${target.mode}${target.kind === "action" ? "." : ":"}${target.name}`;
}

function stateJson(state: State): JsonObject {
  switch (state.status) {
    case "running":
      return { status: state.status };
    case "waiting":
      return { status: state.status, waitingFor: state.waiting.reason, stepKey: state.waiting.stepKey };
    case "done":
      return { status: state.status, output: state.output };
    case "failed":
      return { status: state.status, reason: state.reason };
    case "undone":
      return { status: state.status, reason: state.reason, undo: toJson(state.undo) };
  }
}

function agentOf(task: Task): string {
  return agentName(task.place.mode, skillNameOf(task.skill));
}

function taskJson(task: Task): JsonObject {
  const { files, token } = task;
  return {
    agent: agentOf(task),
    runId: task.runId,
    stepKey: task.stepKey,
    skillFile: files.skill,
    input: task.input,
    outputSchema: files.outputSchema,
    round: task.round,
    feedback: [...task.feedback],
    ...(files.alsoMatches.length === 0 ? {} : { alsoMatches: [...files.alsoMatches] }),
    ...(token === undefined ? {} : { token }),
  };
}

function taskText(run: Run, options: ReportOptions): string {
  const task = taskIn(run);
  if (task === undefined) {
    return "";
  }
  return `task for the agent ${agentOf(task)}. ${noticeOf(run, task, options.after)}\n${pretty(taskJson(task))}`;
}
function stepJson(step: Step, full: boolean): JsonObject {
  const kept = step.kept === undefined ? {} : { kept: step.kept };
  const base = { key: step.key, kind: step.kind, status: step.status, startedAt: step.startedAt, ...kept };
  const sizes = { inputBytes: byteSize(step.input) };
  const payload = full ? { input: step.input, detail: step.detail } : sizes;
  switch (step.status) {
    case "started":
      return { ...base, ...payload };
    case "done":
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

function keptText(kept: Run["kept"]): string {
  return kept === "kept-packed" ? "  kept packed" : "";
}

function stepsText(steps: readonly Step[]): string {
  const lines = steps.map((step) => `  ${step.key}  ${step.kind}  ${step.status}${keptText(step.kept)}`);
  return ["steps:", ...lines].join("\n");
}

function eventsText(events: readonly RunEvent[]): string {
  const lines = events.map((event) => `  ${event.at}  ${event.kind}  ${JSON.stringify(event.detail)}`);
  return ["events:", ...lines].join("\n");
}

function outcomeText(run: Run): string {
  const state = run.state;
  switch (state.status) {
    case "done":
      return run.kept === "kept-packed"
        ? "output: kept packed; bay runs never prints it."
        : `output:\n${pretty(state.output)}`;
    case "failed":
    case "undone":
      return `reason: ${state.reason}`;
    case "running":
    case "waiting":
      return "";
  }
}

function alsoJson(run: Run, waiting: Waiting, options: ReportOptions): JsonObject {
  if (waiting.reason !== "skill") {
    return waitingJson(waiting);
  }
  const { task } = waiting;
  return { ...waitingJson(waiting), task: taskJson(task), notice: noticeOf(run, task, options.after) };
}

function alsoText(run: Run, waiting: Waiting, options: ReportOptions): string {
  if (waiting.reason !== "skill") {
    return `also ${waitingText(run, waiting)}`;
  }
  const { task } = waiting;
  return `also a task for the agent ${agentOf(task)}. ${noticeOf(run, task, options.after)}\n${pretty(taskJson(task))}`;
}

function reportJson(run: Run, options: ReportOptions): JsonObject {
  const also = alsoWaitingIn(run);
  const waiting = waitingIn(run);
  const task = taskIn(run);
  const { askedBy } = run;
  return {
    id: run.id,
    target: { ...run.target },
    ...(run.kept === undefined ? {} : { kept: run.kept }),
    ...stateJson(run.state),
    spent: { ...run.spent },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(waiting === undefined ? {} : { waiting: waitingJson(waiting) }),
    ...(task === undefined ? {} : { task: taskJson(task), notice: noticeOf(run, task, options.after) }),
    ...(also.length === 0 ? {} : { alsoWaiting: also.map((waiting) => alsoJson(run, waiting, options)) }),
    ...(askedBy === undefined ? {} : { askedBy: { ...askedBy } }),
    ...(options.steps === true ? { steps: run.steps.map((step) => stepJson(step, options.full ?? false)) } : {}),
    ...(options.events === true ? { events: run.events.map(eventJson) } : {}),
  };
}

function reportText(run: Run, options: ReportOptions): string {
  const waiting = waitingIn(run);
  const { askedBy } = run;
  const lines = [
    `run ${run.id} (${targetText(run.target)}): ${stateLine(run.state)}`,
    outcomeText(run),
    waiting === undefined ? "" : waitingText(run, waiting),
    askedBy === undefined ? "" : `asked for by step ${askedBy.stepKey} of run ${askedBy.runId} (call_action)`,
    taskText(run, options),
    ...alsoWaitingIn(run).map((waiting) => alsoText(run, waiting, options)),
    options.steps === true ? stepsText(run.steps) : "",
    options.events === true ? eventsText(run.events) : "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export function runResult(layout: Layout, result: Outcome<Run>, options: ReportOptions = {}): CommandResult {
  if (!result.ok) {
    return problemsResult(shownProblems(layout, result.problems));
  }
  const run = result.value;
  const ended = run.state.status === "failed" || run.state.status === "undone";
  return {
    exitCode: ended ? 1 : 0,
    json: { ok: !ended, run: reportJson(run, options) },
    text: reportText(run, options),
  };
}

export function runLine(summary: RunSummary): string {
  return `${summary.id}  ${summary.createdAt}  ${targetText(summary.target)}  ${statusLine(summary)}`;
}

export function runListJson(summary: RunSummary): JsonObject {
  return { ...summary, target: { ...summary.target } };
}
