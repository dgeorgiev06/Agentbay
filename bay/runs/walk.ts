import { charge, frameOverrun, noSpend, type BudgetFrame } from "./budget.ts";
import type { Json, RunEvent, Scrubber, ScriptRunner, Settled, Spend, StepOutcome } from "../contracts.ts";
import type { Budget, Keeping } from "../generated/mode.ts";
import { byteSize } from "../json.ts";
import type { Clock } from "../ports.ts";
import type { ActionTarget, System } from "../manifests/manifests.ts";
import { settledOf, type RunStore, type StepRecord, type Writer } from "./run-store.ts";
import type { RunStatus, Waiting } from "./run-state.ts";
import type { StepDetail, StepKind } from "./step-detail.ts";

export type Services = {
  readonly system: System;
  readonly store: RunStore;
  readonly runner: ScriptRunner;
  readonly clock: Clock;
  readonly scrubber: Scrubber;
};

export type Walk = {
  readonly services: Services;
  readonly writer: Writer;
  readonly records: Map<string, StepRecord>;
  readonly events: readonly RunEvent[];
  readonly now: Date;
  readonly rerunUnfinished: boolean;
  readonly stopReason: string | undefined;
  readonly extra: Budget;
  readonly phase: "main" | "undo";
};

export type Progress = Settled | Extract<RunStatus, { readonly status: "waiting" }>;

export type ActionFrame = ActionTarget & {
  readonly key: string;
  readonly budget: BudgetFrame;
  readonly caller: string | undefined;
  readonly within: Keeping;
};

type EventKind =
  | "run.started"
  | "step.started"
  | "step.finished"
  | "step.failed"
  | "run.waiting"
  | "run.resumed"
  | "approval.recorded"
  | "budget.exceeded"
  | "undo.started"
  | "undo.finished"
  | "run.finished";

type RecordStart = StepDetail & {
  readonly key: string;
  readonly input: Json;
  readonly kept?: Keeping;
};

type RecordEnd = StepOutcome & {
  readonly key: string;
};

type RefusedStart = {
  readonly key: string;
  readonly kind: StepKind;
  readonly input: Json;
  readonly kept?: Keeping;
};

export function done(output: Json): Settled {
  return { status: "done", output };
}

export function failed(reason: string): Settled {
  return { status: "failed", reason };
}

export function waiting(state: Waiting): Progress {
  return { status: "waiting", waiting: state };
}

export function waitingOn(lead: Waiting, others: readonly Waiting[]): Progress {
  return others.length === 0 ? waiting(lead) : { status: "waiting", waiting: lead, alsoWaiting: others };
}

export function eventOf(walk: Walk, kind: EventKind, detail: Json): RunEvent {
  return { at: walk.services.clock.now().toISOString(), runId: walk.writer.runId, kind, detail };
}

export async function startRecord(
  walk: Walk,
  start: RecordStart,
  events: readonly RunEvent[] = [],
): Promise<StepRecord> {
  const event = eventOf(walk, "step.started", {
    stepKey: start.key,
    kind: start.kind,
    inputBytes: byteSize(start.input),
  });
  const at = walk.services.clock.now().toISOString();
  return keep(walk, await walk.services.store.saveStepInput(walk.writer, { ...start, at }, [...events, event]));
}

function stepEndEvent(walk: Walk, end: RecordEnd): RunEvent {
  const kind = walk.records.get(end.key)?.kind ?? "script";
  switch (end.status) {
    case "done":
      return eventOf(walk, "step.finished", {
        stepKey: end.key,
        kind,
        outputBytes: byteSize(end.output),
        spent: end.spent,
      });
    case "failed":
      return eventOf(walk, "step.failed", { stepKey: end.key, kind, reasonBytes: byteSize(end.reason) });
  }
}

function keep(walk: Walk, record: StepRecord): StepRecord {
  walk.records.set(record.key, record);
  return record;
}

export async function endRecord(walk: Walk, end: RecordEnd, events: readonly RunEvent[] = []): Promise<Settled> {
  const at = walk.services.clock.now().toISOString();
  const event = stepEndEvent(walk, end);
  const record = keep(walk, await walk.services.store.saveStepOutput(walk.writer, { ...end, at }, [...events, event]));
  return settledOf(record) ?? end;
}

export async function changeDetail(walk: Walk, change: StepDetail & { readonly key: string }): Promise<StepRecord> {
  const at = walk.services.clock.now().toISOString();
  return keep(walk, await walk.services.store.saveStepDetail(walk.writer, { ...change, at }, []));
}

type CompositeEnd = {
  readonly key: string;
  readonly progress: Progress;
  readonly spent: Spend;
};

export async function concludeComposite(walk: Walk, end: CompositeEnd): Promise<Progress> {
  const { key, progress: outcome, spent } = end;
  switch (outcome.status) {
    case "waiting":
      return outcome;
    case "done":
      return endRecord(walk, { key, status: "done", output: outcome.output, spent });
    case "failed":
      return endRecord(walk, { key, status: "failed", reason: outcome.reason, spent });
  }
}

export function replayed(budget: BudgetFrame, record: StepRecord | undefined): Settled | undefined {
  if (record === undefined || record.status === "started") {
    return undefined;
  }
  charge(budget, record.spent);
  return settledOf(record);
}

export function stopGate(walk: Walk): Settled | undefined {
  return walk.phase === "main" && walk.stopReason !== undefined ? failed(walk.stopReason) : undefined;
}

export function gate(walk: Walk, budget: BudgetFrame, stepKey: string): Progress | undefined {
  const stopped = stopGate(walk);
  if (stopped !== undefined || walk.phase === "undo") {
    return stopped;
  }
  const overrun = frameOverrun(budget);
  return overrun === undefined ? undefined : waiting({ reason: "budget", stepKey, overrun });
}

export async function refuse(walk: Walk, start: RefusedStart, reason: string): Promise<Settled> {
  if (walk.records.has(start.key)) {
    return endRecord(walk, { key: start.key, status: "failed", reason, spent: noSpend });
  }
  const at = walk.services.clock.now().toISOString();
  const events = [
    eventOf(walk, "step.started", { stepKey: start.key, kind: start.kind, inputBytes: byteSize(start.input) }),
    eventOf(walk, "step.failed", { stepKey: start.key, kind: start.kind, reasonBytes: byteSize(reason) }),
  ];
  const record = await walk.services.store.saveRefusal(walk.writer, { ...start, reason, at }, events);
  return settledOf(keep(walk, record)) ?? failed(reason);
}
