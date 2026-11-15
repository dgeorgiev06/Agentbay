import { join } from "node:path/posix";
import { charge, frameOverrun, noSpend, type BudgetFrame } from "./budget.ts";
import type { Json, PolicyOf, RunEvent, ScriptRunner, Spend } from "./contracts.ts";
import type { Budget } from "./generated/mode.ts";
import { byteSize } from "./json.ts";
import type { Clock, FileSystem } from "./ports.ts";
import type { LoadedMode, System } from "./registry.ts";
import type { RunStore, StepEnd, StepKind, StepRecord, Writer } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { checkValue } from "./spec.ts";
import type { Problem } from "./outcome.ts";
import type { ActionTarget } from "./targets.ts";

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

export type Settled =
  { readonly kind: "done"; readonly output: Json } | { readonly kind: "failed"; readonly reason: string };

export type Progress = Settled | { readonly kind: "waiting"; readonly waiting: Waiting };

export type ActionFrame = ActionTarget & {
  readonly key: string;
  readonly budget: BudgetFrame;
  readonly caller: string | undefined;
};

export type EventKind =
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

export type RecordStart = {
  readonly key: string;
  readonly kind: StepKind;
  readonly input: Json;
  readonly detail: Json;
};

export type RecordEnd = {
  readonly key: string;
  readonly settled: Settled;
  readonly spent: Spend;
};

export type SchemaCheck = {
  readonly mode: LoadedMode;
  readonly schema: string;
  readonly value: Json;
  readonly label: string;
};

export function done(output: Json): Settled {
  return { kind: "done", output };
}

export function failed(reason: string): Settled {
  return { kind: "failed", reason };
}

export function waiting(state: Waiting): Progress {
  return { kind: "waiting", waiting: state };
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
  const record = await walk.services.store.saveStepInput(walk.writer, { ...start, at }, [...events, event]);
  walk.records.set(record.key, record);
  return record;
}

function stepEndOf(end: RecordEnd, at: string): StepEnd {
  switch (end.settled.kind) {
    case "done":
      return { key: end.key, status: "finished", output: end.settled.output, spent: end.spent, at };
    case "failed":
      return { key: end.key, status: "failed", reason: end.settled.reason, spent: end.spent, at };
  }
}

function stepEndEvent(walk: Walk, end: RecordEnd): RunEvent {
  const kind = walk.records.get(end.key)?.kind ?? "script";
  switch (end.settled.kind) {
    case "done":
      return eventOf(walk, "step.finished", {
        stepKey: end.key,
        kind,
        outputBytes: byteSize(end.settled.output),
        spent: end.spent,
      });
    case "failed":
      return eventOf(walk, "step.failed", { stepKey: end.key, kind, reasonBytes: byteSize(end.settled.reason) });
  }
}

function storedSettled(record: StepRecord): Settled | undefined {
  switch (record.status) {
    case "started":
      return undefined;
    case "finished":
      return done(record.output);
    case "failed":
      return failed(record.reason);
  }
}

export async function endRecord(walk: Walk, end: RecordEnd, events: readonly RunEvent[] = []): Promise<Settled> {
  const at = walk.services.clock.now().toISOString();
  const event = stepEndEvent(walk, end);
  const record = await walk.services.store.saveStepOutput(walk.writer, stepEndOf(end, at), [...events, event]);
  walk.records.set(record.key, record);
  return storedSettled(record) ?? end.settled;
}

export async function changeDetail(walk: Walk, key: string, detail: Json): Promise<StepRecord> {
  const at = walk.services.clock.now().toISOString();
  const record = await walk.services.store.saveStepDetail(walk.writer, { key, detail, at }, []);
  walk.records.set(record.key, record);
  return record;
}

export async function concludeComposite(
  walk: Walk,
  key: string,
  outcome: Progress & { spent: Spend },
): Promise<Progress> {
  switch (outcome.kind) {
    case "waiting":
      return outcome;
    case "done":
      return endRecord(walk, { key, settled: done(outcome.output), spent: outcome.spent });
    case "failed":
      return endRecord(walk, { key, settled: failed(outcome.reason), spent: outcome.spent });
  }
}

export function replayed(budget: BudgetFrame, record: StepRecord | undefined): Settled | undefined {
  if (record === undefined) {
    return undefined;
  }
  switch (record.status) {
    case "started":
      return undefined;
    case "finished":
      charge(budget, record.spent);
      return done(record.output);
    case "failed":
      charge(budget, record.spent);
      return failed(record.reason);
  }
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

export async function refuse(walk: Walk, start: Omit<RecordStart, "detail">, reason: string): Promise<Settled> {
  if (!walk.records.has(start.key)) {
    await startRecord(walk, { ...start, detail: {} });
  }
  return endRecord(walk, { key: start.key, settled: failed(reason), spent: noSpend });
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
