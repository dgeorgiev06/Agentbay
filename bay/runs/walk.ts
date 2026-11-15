import { join } from "node:path/posix";
import { charge, frameOverrun, noSpend, type BudgetFrame } from "./budget.ts";
import type { Json, PolicyOf, RunEvent, ScriptRunner, Settled, Spend, StepOutcome } from "../contracts.ts";
import type { Budget } from "../generated/mode.ts";
import { byteSize } from "../json.ts";
import type { Clock, FileSystem } from "../ports.ts";
import type { LoadedMode, System } from "../registry.ts";
import { settledOf, type RunStore, type StepRecord, type Writer } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import type { StepDetail, StepKind } from "./step-detail.ts";
import { checkValue } from "../spec.ts";
import type { Problem } from "../outcome.ts";
import type { ActionTarget } from "../targets.ts";

export type Services = {
  readonly system: System;
  readonly store: RunStore;
  readonly runner: ScriptRunner;
  readonly policyOf: PolicyOf;
  readonly clock: Clock;
  readonly files: FileSystem;
};

export type Walk = {
  readonly services: Services;
  readonly writer: Writer;
  readonly records: Map<string, StepRecord>;
  readonly now: Date;
  readonly rerunUnfinished: boolean;
  readonly stopReason: string | undefined;
  readonly extra: Budget;
  readonly phase: "main" | "undo";
};

export type Progress = Settled | { readonly status: "waiting"; readonly waiting: Waiting };

export type ActionFrame = ActionTarget & {
  readonly key: string;
  readonly budget: BudgetFrame;
  readonly caller: string | undefined;
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
};

type RecordEnd = StepOutcome & {
  readonly key: string;
};

type RefusedStart = {
  readonly key: string;
  readonly kind: StepKind;
  readonly input: Json;
};

type SchemaCheck = {
  readonly mode: LoadedMode;
  readonly schema: string;
  readonly value: Json;
  readonly label: string;
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
      return waiting(outcome.waiting);
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

function parsedSchema(text: string): { readonly schema: unknown } | { readonly reason: string } {
  try {
    const schema: unknown = JSON.parse(text);
    return { schema };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function schemaProblems(services: Services, check: SchemaCheck): Promise<readonly Problem[]> {
  const file = join(check.mode.folder, check.schema);
  const text = await services.files.readText(file);
  if (text === undefined) {
    return [
      { file, path: "", message: `The schema file ${file} does not exist, so the ${check.label} is not checked.` },
    ];
  }
  const parsed = parsedSchema(text);
  if ("reason" in parsed) {
    return [{ file, path: "", message: `The schema file ${file} is not valid JSON: ${parsed.reason}.` }];
  }
  const loaded = { file, value: check.value, lineOf: () => undefined };
  const result = checkValue(parsed.schema, check.value, { loaded, path: [check.label] });
  if (result.kind === "unusable-schema") {
    return [{ file, path: "", message: `The schema file ${file} is not a usable JSON Schema: ${result.reason}.` }];
  }
  return result.problems;
}
