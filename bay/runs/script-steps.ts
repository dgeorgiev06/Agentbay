import {
  addSpend,
  charge,
  frameAfterMinutes,
  frameRemaining,
  noSpend,
  subtractSpend,
  turnsToTake,
  type Turn,
} from "./budget.ts";
import {
  defaultScriptTimeLimitSeconds,
  type ActionCaller,
  type Json,
  type Permissions,
  type RandomDrawer,
  type ScriptRequest,
  type Spend,
  type StepOutcome,
  type StepPlace,
  type StepTimeLimit,
} from "../contracts.ts";
import type { Budget, Keeping } from "../generated/mode.ts";
import type { StepRecord } from "./run-store.ts";
import { drawerFor } from "./drawn-values.ts";
import type { ScriptDetail } from "./step-detail.ts";
import { scriptCallKey } from "./step-key.ts";
import {
  changeDetail,
  endRecord,
  eventOf,
  gate,
  replayed,
  startRecord,
  stopGate,
  waiting,
  type ActionFrame,
  type Progress,
  type Walk,
} from "./walk.ts";

export type CallStep = {
  readonly key: string;
  readonly call: string;
  readonly input: Json;
};

export type CallRunner = (walk: Walk, frame: ActionFrame, call: CallStep) => Promise<Progress>;

export type ScriptLeaf = {
  readonly key: string;
  readonly kind: "script" | "check";
  readonly script: string;
  readonly input: Json;
  readonly place: StepPlace;
  readonly kept: Keeping;
  readonly skillInput?: Json;
};

type HeldWait = {
  waiting: Progress | undefined;
};

type StoppedAttempt = {
  readonly leaf: ScriptLeaf;
  readonly detail: ScriptDetail;
  readonly outcome: StepOutcome;
  readonly waiting: Progress;
};

export function frameLabel(frame: ActionFrame): string {
  return `action ${frame.name} of mode ${frame.mode.manifest.name}`;
}

function scriptDetailOf(record: StepRecord | undefined): ScriptDetail | undefined {
  if (record === undefined || (record.kind !== "script" && record.kind !== "check")) {
    return undefined;
  }
  return record.detail ?? undefined;
}

function mayRerun(walk: Walk, frame: ActionFrame): boolean {
  return walk.rerunUnfinished || frame.action.effects.every((effect) => effect === "read");
}

function unfinishedWaiting(frame: ActionFrame, key: string): Progress {
  return waiting({
    reason: "owner",
    stepKey: key,
    question:
      `Step ${key} started and did not finish, and ${frameLabel(frame)} has the effects ` +
      `${frame.action.effects.join(", ")}, so running it again could repeat them. ` +
      "Resume with --rerun to run it again, or stop the run.",
  });
}

function calledOutcome(progress: Progress, reference: string, spent: Spend): StepOutcome {
  switch (progress.status) {
    case "done":
      return { status: "done", output: progress.output, spent };
    case "failed":
      return { status: "failed", reason: progress.reason, spent };
    case "waiting":
      return {
        status: "failed",
        reason:
          `${reference} stopped to wait for ${progress.waiting.reason}; ` +
          "this step stops too and runs again when the run resumes, with its finished calls replayed.",
        spent,
      };
  }
}

export type ScriptStep = {
  readonly leaf: ScriptLeaf;
  readonly calls: CallRunner;
};

type ScriptAt = {
  readonly leaf: ScriptLeaf;
  readonly calls: CallRunner;
  readonly held: HeldWait;
  readonly startedAt: Date;
  readonly step: StartedScript;
};

type StartedScript = {
  readonly detail: ScriptDetail;
  readonly startedAt: string;
  readonly random: RandomDrawer;
};

function minutesSince(walk: Walk, time: Date): number {
  return (walk.services.clock.now().getTime() - time.getTime()) / 60_000;
}

function actionCaller(walk: Walk, frame: ActionFrame, at: ScriptAt): ActionCaller {
  let count = 0;
  return async (reference, input) => {
    const key = scriptCallKey(at.leaf.key, count);
    count += 1;
    const before = frame.budget.spent;
    const budget = frameAfterMinutes(frame.budget, minutesSince(walk, at.startedAt));
    const progress = await at.calls(walk, { ...frame, budget }, { key, call: reference, input });
    if (progress.status === "waiting") {
      at.held.waiting ??= progress;
    }
    return calledOutcome(progress, reference, subtractSpend(frame.budget.spent, before));
  };
}

export function actionPermissions(walk: Walk, frame: ActionFrame): Permissions {
  return { grants: frame.mode.grants, actionEffects: frame.action.effects };
}

function ownTimeLimit(frame: ActionFrame, leaf: ScriptLeaf): StepTimeLimit {
  const declared = leaf.kind === "script" ? frame.action.scriptTimeLimitSeconds : undefined;
  if (declared === undefined) {
    return { timeLimitMilliseconds: defaultScriptTimeLimitSeconds * 1000, timeLimitSetBy: "kernel" };
  }
  return { timeLimitMilliseconds: declared * 1000, timeLimitSetBy: "action" };
}

function stepTimeLimit(own: StepTimeLimit, remaining: Budget): StepTimeLimit {
  const minutes = remaining.minutes;
  if (minutes === undefined || minutes * 60_000 >= own.timeLimitMilliseconds) {
    return own;
  }
  return { timeLimitMilliseconds: Math.max(0, minutes * 60_000), timeLimitSetBy: "budget" };
}

function scriptRequest(walk: Walk, frame: ActionFrame, at: ScriptAt): ScriptRequest {
  const { leaf } = at;
  const remaining = frameRemaining(frame.budget);
  return {
    place: leaf.place,
    script: leaf.script,
    input: leaf.input,
    permissions: actionPermissions(walk, frame),
    settings: frame.mode.settings,
    remaining,
    ...stepTimeLimit(ownTimeLimit(frame, leaf), remaining),
    call: actionCaller(walk, frame, at),
    random: at.step.random,
    startedAt: new Date(at.step.startedAt),
    ...(frame.caller === undefined ? {} : { caller: frame.caller }),
    ...(leaf.skillInput === undefined ? {} : { skillInput: leaf.skillInput }),
  };
}

function latestDetail(walk: Walk, leaf: ScriptLeaf, started: ScriptDetail): ScriptDetail {
  return scriptDetailOf(walk.records.get(leaf.key)) ?? started;
}

async function stopForCall(walk: Walk, stopped: StoppedAttempt): Promise<Progress> {
  const latest = latestDetail(walk, stopped.leaf, stopped.detail);
  const stoppedForCall = addSpend(latest.stoppedForCall ?? noSpend, stopped.outcome.spent);
  const detail = { ...latest, stoppedForCall };
  await changeDetail(walk, { key: stopped.leaf.key, kind: stopped.leaf.kind, detail });
  return stopped.waiting;
}

async function noteRerun(walk: Walk, leaf: ScriptLeaf): Promise<void> {
  const event = eventOf(walk, "step.started", { stepKey: leaf.key, kind: leaf.kind, rerun: true });
  await walk.services.store.append(event);
}

export async function runScript(walk: Walk, frame: ActionFrame, script: ScriptStep): Promise<Progress> {
  const record = walk.records.get(script.leaf.key);
  const replay = replayed(frame.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const spends = frame.action.effects.includes("spend");
  return inTurns(turnsToTake(frame.budget, spends), () => gatedScript(walk, frame, { ...script, record }));
}

function inTurns(turns: readonly Turn[], body: () => Promise<Progress>): Promise<Progress> {
  const [first, ...rest] = turns;
  return first === undefined ? body() : first.turns.take(first.holder, () => inTurns(rest, body));
}

function gatedScript(
  walk: Walk,
  frame: ActionFrame,
  at: ScriptStep & { readonly record: StepRecord | undefined },
): Promise<Progress> {
  const { leaf, record } = at;
  const blocked = leaf.kind === "check" ? stopGate(walk) : gate(walk, frame.budget, leaf.key);
  if (blocked !== undefined) {
    return Promise.resolve(blocked);
  }
  const stoppedForCall = scriptDetailOf(record)?.stoppedForCall !== undefined;
  if (record !== undefined && !mayRerun(walk, frame) && !stoppedForCall) {
    return Promise.resolve(unfinishedWaiting(frame, leaf.key));
  }
  return attemptScript(walk, frame, at);
}

function drawerOf(walk: Walk, leaf: ScriptLeaf, detail: ScriptDetail): RandomDrawer {
  return drawerFor(leaf.key, detail.drawn ?? [], async (drawn) => {
    const latest = latestDetail(walk, leaf, detail);
    await changeDetail(walk, { key: leaf.key, kind: leaf.kind, detail: { ...latest, drawn } });
  });
}

async function startedRecord(
  walk: Walk,
  at: { leaf: ScriptLeaf; record: StepRecord | undefined },
): Promise<Omit<StartedScript, "random">> {
  const { leaf, record } = at;
  const detail = scriptDetailOf(record) ?? { script: leaf.script };
  if (record !== undefined) {
    await noteRerun(walk, leaf);
    return { detail, startedAt: record.startedAt };
  }
  const started = await startRecord(walk, {
    key: leaf.key,
    kind: leaf.kind,
    input: leaf.input,
    kept: leaf.kept,
    detail,
  });
  return { detail, startedAt: started.startedAt };
}

async function startedScript(
  walk: Walk,
  at: { leaf: ScriptLeaf; record: StepRecord | undefined },
): Promise<StartedScript> {
  const { detail, startedAt } = await startedRecord(walk, at);
  return { detail, startedAt, random: drawerOf(walk, at.leaf, detail) };
}

async function attemptScript(
  walk: Walk,
  frame: ActionFrame,
  at: ScriptStep & { readonly record: StepRecord | undefined },
): Promise<Progress> {
  const leaf = { ...at.leaf, input: at.record?.input ?? at.leaf.input };
  const step = await startedScript(walk, { leaf, record: at.record });
  const { detail } = step;
  const startedAt = walk.services.clock.now();
  await walk.services.store.heartbeat(walk.writer, startedAt);
  const before = frame.budget.spent;
  charge(frame.budget, detail.stoppedForCall ?? noSpend);
  const held: HeldWait = { waiting: undefined };
  const outcome = await walk.services.runner.run(
    scriptRequest(walk, frame, { leaf, calls: at.calls, held, startedAt, step }),
  );
  charge(frame.budget, outcome.spent);
  if (held.waiting !== undefined) {
    return stopForCall(walk, { leaf, detail, outcome, waiting: held.waiting });
  }
  return endRecord(walk, { ...outcome, key: leaf.key, spent: subtractSpend(frame.budget.spent, before) });
}
