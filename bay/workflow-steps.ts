import { runNestedAction } from "./action-steps.ts";
import { noSpend, subtractSpend, type BudgetFrame } from "./budget.ts";
import type { Json } from "./contracts.ts";
import type { Step as WorkflowStep } from "./generated/workflow.ts";
import { hashOf, textField, toJson } from "./json.ts";
import { resolveInput, resolveValue, type ReferenceScope, type Resolution } from "./references.ts";
import type { LoadedMode } from "./registry.ts";
import type { StepRecord } from "./run-store.ts";
import { resolveWorkflowAction } from "./targets.ts";
import {
  changeDetail,
  concludeComposite,
  done,
  endRecord,
  eventOf,
  failed,
  refuse,
  replayed,
  startRecord,
  stopGate,
  waiting,
  type Progress,
  type Walk,
} from "./walk.ts";

export type WorkflowScope = {
  readonly mode: LoadedMode;
  readonly budget: BudgetFrame;
  readonly prefix: string;
  readonly trigger: Json;
  readonly outputs: Map<string, Json>;
  readonly item: Json | undefined;
};

type ActionStep = Extract<WorkflowStep, { readonly action: string }>;

type ApprovalStep = Extract<WorkflowStep, { readonly approval: string }>;

type WaitStep = Extract<WorkflowStep, { readonly wait: string }>;

type ForeachStep = Extract<WorkflowStep, { readonly foreach: string }>;

type WorkflowStepOf =
  | { readonly kind: "action"; readonly step: ActionStep }
  | { readonly kind: "approval"; readonly step: ApprovalStep }
  | { readonly kind: "wait"; readonly step: WaitStep }
  | { readonly kind: "foreach"; readonly step: ForeachStep };

type StepAt<T> = {
  readonly step: T;
  readonly key: string;
  readonly previous: Json;
};

type Shown = {
  readonly record: StepRecord;
  readonly content: Json;
  readonly hash: string;
};

const unitMilliseconds: ReadonlyMap<string, number> = new Map([
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
]);

function referenceScope(scope: WorkflowScope): ReferenceScope {
  const base = { trigger: scope.trigger, outputs: scope.outputs, settings: scope.mode.settings };
  return scope.item === undefined ? base : { ...base, item: scope.item };
}

function durationMilliseconds(text: string): number {
  const unit = unitMilliseconds.get(text.slice(-1)) ?? 0;
  return Number(text.slice(0, -1)) * unit;
}

function given(value: Json): Resolution {
  return { ok: true, value };
}

async function runWorkflowAction(walk: Walk, scope: WorkflowScope, at: StepAt<ActionStep>): Promise<Progress> {
  const record = walk.records.get(at.key);
  const replay = replayed(scope.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const start = { key: at.key, kind: "action" as const, input: at.previous };
  const stepInput = at.step.input;
  const input =
    record !== undefined || stepInput === undefined
      ? given(at.previous)
      : resolveInput(stepInput, referenceScope(scope));
  if (!input.ok) {
    return refuse(walk, start, `Step ${at.step.id} cannot start: ${input.problems.join(" ")}`);
  }
  const target = resolveWorkflowAction(walk.services.system, scope.mode, at.step.action);
  if (typeof target === "string") {
    return refuse(walk, start, target);
  }
  const caller = at.step.action.includes(".") ? scope.mode.manifest.name : undefined;
  return runNestedAction(walk, scope.budget, { key: at.key, kind: "action", target, input: input.value, caller });
}

function approvalWaiting(at: StepAt<ApprovalStep>, record: StepRecord, content: Json): Progress {
  const previousHash = textField(record.detail, "previousHash");
  return waiting({
    reason: "approval",
    stepKey: at.key,
    question: at.step.approval,
    hash: textField(record.detail, "hash") ?? "",
    content,
    ...(previousHash === undefined ? {} : { previousHash }),
  });
}

async function settleApproval(walk: Walk, at: StepAt<ApprovalStep>, shown: Shown): Promise<Progress> {
  const recordedHash = textField(shown.record.detail, "hash") ?? "";
  if (recordedHash !== shown.hash) {
    const detail = { hash: shown.hash, previousHash: recordedHash, shown: shown.content };
    const changed = await changeDetail(walk, at.key, detail);
    return approvalWaiting(at, changed, shown.content);
  }
  const decision = textField(shown.record.detail, "decision");
  const by = textField(shown.record.detail, "by") ?? "";
  if (decision === undefined) {
    return approvalWaiting(at, shown.record, shown.content);
  }
  const recorded = eventOf(walk, "approval.recorded", { stepKey: at.key, hash: shown.hash, decision, by });
  const settled =
    decision === "approve" ? done(shown.content) : failed(`${by} rejected step ${at.step.id}: ${at.step.approval}`);
  return endRecord(walk, { key: at.key, settled, spent: noSpend }, [recorded]);
}

async function runApproval(walk: Walk, scope: WorkflowScope, at: StepAt<ApprovalStep>): Promise<Progress> {
  const record = walk.records.get(at.key);
  const replay = replayed(scope.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const show = at.step.show;
  const content = show === undefined ? given(at.previous) : resolveValue(show, referenceScope(scope));
  if (!content.ok) {
    const start = { key: at.key, kind: "approval" as const, input: at.previous };
    return refuse(walk, start, `Step ${at.step.id} cannot show anything: ${content.problems.join(" ")}`);
  }
  const stopped = stopGate(walk);
  if (stopped !== undefined) {
    return stopped;
  }
  const hash = hashOf(content.value);
  if (record === undefined) {
    const started = await startRecord(walk, { key: at.key, kind: "approval", input: content.value, detail: { hash } });
    return approvalWaiting(at, started, content.value);
  }
  return settleApproval(walk, at, { record, content: content.value, hash });
}

async function runWait(walk: Walk, scope: WorkflowScope, at: StepAt<WaitStep>): Promise<Progress> {
  const record = walk.records.get(at.key);
  const replay = replayed(scope.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const stopped = stopGate(walk);
  if (stopped !== undefined) {
    return stopped;
  }
  const until = new Date(walk.now.getTime() + durationMilliseconds(at.step.wait)).toISOString();
  const started =
    record ?? (await startRecord(walk, { key: at.key, kind: "wait", input: at.previous, detail: { until } }));
  const due = textField(started.detail, "until") ?? until;
  if (walk.now.getTime() >= new Date(due).getTime()) {
    return endRecord(walk, { key: at.key, settled: done(started.input), spent: noSpend });
  }
  return waiting({ reason: "time", stepKey: at.key, until: due });
}

function describeValue(value: Json): string {
  if (value === null || typeof value !== "object") {
    return `the value ${JSON.stringify(value)}`;
  }
  return "a mapping";
}

async function runForeach(walk: Walk, scope: WorkflowScope, at: StepAt<ForeachStep>): Promise<Progress> {
  const record = walk.records.get(at.key);
  const replay = replayed(scope.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const start = { key: at.key, kind: "foreach" as const, input: at.previous };
  const list = record === undefined ? resolveValue(at.step.foreach, referenceScope(scope)) : given(record.input);
  if (!list.ok) {
    return refuse(walk, start, `Step ${at.step.id} has no list: ${list.problems.join(" ")}`);
  }
  if (!Array.isArray(list.value)) {
    const reason =
      `Step ${at.step.id} runs over ${at.step.foreach}, ` + `which is ${describeValue(list.value)}, not a list.`;
    return refuse(walk, start, reason);
  }
  const items: readonly Json[] = list.value.map((item: unknown) => toJson(item));
  if (record === undefined) {
    await startRecord(walk, { key: at.key, kind: "foreach", input: items, detail: {} });
  }
  return runItems(walk, scope, { at, items });
}

async function runItems(
  walk: Walk,
  scope: WorkflowScope,
  loop: { readonly at: StepAt<ForeachStep>; readonly items: readonly Json[] },
): Promise<Progress> {
  const before = scope.budget.spent;
  const outputs: Json[] = [];
  for (const [index, item] of loop.items.entries()) {
    const prefix = `${loop.at.key}[${String(index)}].`;
    const inner = { ...scope, prefix, outputs: new Map(scope.outputs), item };
    const progress = await runWorkflowSteps(walk, inner, { steps: loop.at.step.steps, start: item });
    if (progress.kind !== "done") {
      return concludeComposite(walk, loop.at.key, { ...progress, spent: subtractSpend(scope.budget.spent, before) });
    }
    outputs.push(progress.output);
  }
  return concludeComposite(walk, loop.at.key, { ...done(outputs), spent: subtractSpend(scope.budget.spent, before) });
}

function workflowStepOf(step: WorkflowStep): WorkflowStepOf {
  if ("action" in step) {
    return { kind: "action", step };
  }
  if ("approval" in step) {
    return { kind: "approval", step };
  }
  if ("wait" in step) {
    return { kind: "wait", step };
  }
  return { kind: "foreach", step };
}

function runWorkflowStep(walk: Walk, scope: WorkflowScope, at: StepAt<WorkflowStep>): Promise<Progress> {
  const of = workflowStepOf(at.step);
  switch (of.kind) {
    case "action":
      return runWorkflowAction(walk, scope, { ...at, step: of.step });
    case "approval":
      return runApproval(walk, scope, { ...at, step: of.step });
    case "wait":
      return runWait(walk, scope, { ...at, step: of.step });
    case "foreach":
      return runForeach(walk, scope, { ...at, step: of.step });
  }
}

export async function runWorkflowSteps(
  walk: Walk,
  scope: WorkflowScope,
  list: { readonly steps: readonly WorkflowStep[]; readonly start: Json },
): Promise<Progress> {
  let previous = list.start;
  for (const step of list.steps) {
    const progress = await runWorkflowStep(walk, scope, { step, key: `${scope.prefix}${step.id}`, previous });
    if (progress.kind !== "done") {
      return progress;
    }
    scope.outputs.set(step.id, progress.output);
    previous = progress.output;
  }
  return done(previous);
}
