import { approvalLines } from "./approval-card.ts";
import type { Json } from "./contracts.ts";
import { toJson } from "./json.ts";
import { waitsOf, type Run, type RunSummary, type Task } from "./runs/runs.ts";
import type { JsonObject } from "./command-context.ts";

export type ReportOptions = {
  readonly after?: "submit" | "reissue";
  readonly full?: boolean;
  readonly events?: boolean;
  readonly steps?: boolean;
};

type State = Run["state"];

type Waiting = Extract<State, { readonly status: "waiting" }>["waiting"];

const sourceWords = '[--via terminal | --via chat --quote "<the owner\'s exact words>"]';

const issuedNotice = "A task token was issued with this task; it is shown only now.";

const replacedNotice = "A new task token was issued; the token shown earlier for this task no longer works.";

function newTokenCommand(run: Run, task: Task): string {
  return `bay runs ${run.id} --new-token --step ${task.stepKey}`;
}

export function noticeOf(run: Run, task: Task, after: ReportOptions["after"]): string {
  if (task.token !== undefined) {
    return after === "reissue" ? replacedNotice : issuedNotice;
  }
  if (after === "submit") {
    return `The run waits for another skill step; ${newTokenCommand(run, task)} gives its task with a token.`;
  }
  return `The token was shown when this task was issued. ${newTokenCommand(run, task)} replaces it with a new one.`;
}

function waitingLine(waits: readonly { readonly reason: string; readonly stepKey: string }[]): string {
  return `waiting for ${waits.map((wait) => `${wait.reason} at ${wait.stepKey}`).join(", and for ")}`;
}

export function stateLine(state: State): string {
  return state.status === "waiting" ? waitingLine(waitsOf(state)) : state.status;
}

export function statusLine(summary: RunSummary): string {
  if (summary.status !== "waiting") {
    return summary.status;
  }
  const lead = { reason: summary.waitingFor, stepKey: summary.stepKey };
  const also = (summary.alsoWaiting ?? []).map((wait) => ({ reason: wait.waitingFor, stepKey: wait.stepKey }));
  return waitingLine([lead, ...also]);
}

export function waitingJson(waiting: Waiting): JsonObject {
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
        ...(waiting.choices === undefined ? {} : { choices: waiting.choices.map((choice) => ({ ...choice })) }),
        ...(waiting.card === undefined ? {} : { card: toJson(waiting.card) }),
      };
    case "time":
      return { reason: waiting.reason, stepKey: waiting.stepKey, until: waiting.until };
    case "budget":
      return { reason: waiting.reason, stepKey: waiting.stepKey, overrun: toJson(waiting.overrun) };
    case "owner":
      return { reason: waiting.reason, stepKey: waiting.stepKey, question: waiting.question };
  }
}

export function pretty(value: Json): string {
  return JSON.stringify(value, null, 2);
}

function decideLine(run: Run, waiting: Extract<Waiting, { readonly reason: "approval" }>): string {
  const decide = `decide with: bay approve ${run.id} ${waiting.stepKey}`;
  return waiting.choices === undefined
    ? `${decide} --hash ${waiting.hash} [--reject]`
    : `${decide} --choice <name> --hash ${waiting.hash}`;
}

function stopCommand(run: Run): string {
  return `bay resume ${run.id} --stop ${sourceWords}`;
}

function stopLine(run: Run): string {
  return `or stop with: ${stopCommand(run)}`;
}

function stopsAtUntil(run: Run, waiting: Extract<Waiting, { readonly reason: "owner" }>): boolean {
  return run.target.part?.until === waiting.stepKey;
}

function ownerLines(run: Run, waiting: Extract<Waiting, { readonly reason: "owner" }>): readonly string[] {
  if (stopsAtUntil(run, waiting)) {
    return [waiting.question, `stop with: ${stopCommand(run)}`];
  }
  return [waiting.question, `run again with: bay resume ${run.id} --rerun ${sourceWords}`, stopLine(run)];
}

export function waitingText(run: Run, waiting: Waiting): string {
  switch (waiting.reason) {
    case "skill":
      return "";
    case "approval":
      return [...approvalLines(waiting), decideLine(run, waiting)].join("\n");
    case "time":
      return `wakes at ${waiting.until}; bay resume --due wakes it then`;
    case "budget":
      return [
        `the budget is spent: ${pretty(toJson(waiting.overrun))}`,
        `raise it with: bay resume ${run.id} --extend <measure>=<amount> ${sourceWords}`,
        stopLine(run),
      ].join("\n");
    case "owner":
      return ownerLines(run, waiting).join("\n");
  }
}

export function waitingIn(run: Run): Waiting | undefined {
  return run.state.status === "waiting" ? run.state.waiting : undefined;
}

export function alsoWaitingIn(run: Run): readonly Waiting[] {
  return waitsOf(run.state).slice(1);
}

export function taskIn(run: Run): Task | undefined {
  const waiting = waitingIn(run);
  return waiting?.reason === "skill" ? waiting.task : undefined;
}
