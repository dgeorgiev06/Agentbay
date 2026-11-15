import { runNestedAction } from "./action-steps.ts";
import { noSpend, subtractSpend, type BudgetFrame } from "./budget.ts";
import type { Json } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import { hashOf, toJson } from "../json.ts";
import { problemText, succeededWith } from "../outcome.ts";
import { resolveInput, resolveValue, type ReferenceScope } from "../references.ts";
import type { LoadedMode } from "../registry.ts";
import type { StepRecord } from "./run-store.ts";
import type { ApprovalDetail } from "./step-detail.ts";
import { foreachItemKey, workflowStepKey } from "./step-key.ts";
import { resolveWorkflowAction } from "../targets.ts";
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

type WorkflowScope = {
  readonly mode: LoadedMode;
  readonly budget: BudgetFrame;
  readonly within: string;
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
  readonly detail: ApprovalDetail;
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
      ? succeededWith(at.previous)
      : resolveInput(stepInput, referenceScope(scope));
  if (!input.ok) {
    return refuse(walk, start, `Step ${at.step.id} cannot start: ${problemText(input.problems)}`);
  }
  const target = resolveWorkflowAction(walk.services.system, scope.mode, at.step.action);
  if (typeof target === "string") {
    return refuse(walk, start, target);
  }
  const caller = at.step.action.includes(".") ? scope.mode.manifest.name : undefined;
  return runNestedAction(walk, scope.budget, { key: at.key, kind: "action", target, input: input.value, caller });
}

function approvalWaiting(at: StepAt<ApprovalStep>, detail: ApprovalDetail, content: Json): Progress {
  const previousHash = detail.previousHash;
  return waiting({
    reason: "approval",
    stepKey: at.key,
    question: detail.question,
    hash: detail.hash,
    content,
    ...(previousHash === undefined ? {} : { previousHash }),
  });
}

function approvalDetailOf(record: StepRecord): ApprovalDetail | undefined {
  return record.kind === "approval" ? (record.detail ?? undefined) : undefined;
}

async function settleApproval(walk: Walk, at: StepAt<ApprovalStep>, shown: Shown): Promise<Progress> {
  const recordedHash = shown.detail.hash;
  if (recordedHash !== shown.hash) {
    const question = shown.detail.question;
    const detail = { question, hash: shown.hash, previousHash: recordedHash, shown: shown.content };
    await changeDetail(walk, { key: at.key, kind: "approval", detail });
    return approvalWaiting(at, detail, shown.content);
  }
  const verdict = shown.detail.verdict;
  if (verdict === undefined) {
    return approvalWaiting(at, shown.detail, shown.content);
  }
  const { decision, by } = verdict;
  const recorded = eventOf(walk, "approval.recorded", { stepKey: at.key, hash: shown.hash, decision, by });
  const settled =
    decision === "approve" ? done(shown.content) : failed(`${by} rejected step ${at.step.id}: ${at.step.approval}`);
  return endRecord(walk, { ...settled, key: at.key, spent: noSpend }, [recorded]);
}

async function runApproval(walk: Walk, scope: WorkflowScope, at: StepAt<ApprovalStep>): Promise<Progress> {
  const record = walk.records.get(at.key);
  const replay = replayed(scope.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const show = at.step.show;
  const content = show === undefined ? succeededWith(at.previous) : resolveValue(show, referenceScope(scope));
  if (!content.ok) {
    const start = { key: at.key, kind: "approval" as const, input: at.previous };
    return refuse(walk, start, `Step ${at.step.id} cannot show anything: ${problemText(content.problems)}`);
  }
  const stopped = stopGate(walk);
  if (stopped !== undefined) {
    return stopped;
  }
  const hash = hashOf(content.value);
  const detail = record === undefined ? undefined : approvalDetailOf(record);
  if (detail === undefined) {
    const started = { question: at.step.approval, hash };
    await startRecord(walk, { key: at.key, kind: "approval", input: content.value, detail: started });
    return approvalWaiting(at, started, content.value);
  }
  return settleApproval(walk, at, { detail, content: content.value, hash });
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
  const due = started.kind === "wait" && started.detail !== null ? started.detail.until : until;
  if (walk.now.getTime() >= new Date(due).getTime()) {
    return endRecord(walk, { key: at.key, status: "done", output: started.input, spent: noSpend });
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
  const list =
    record === undefined ? resolveValue(at.step.foreach, referenceScope(scope)) : succeededWith(record.input);
  if (!list.ok) {
    return refuse(walk, start, `Step ${at.step.id} has no list: ${problemText(list.problems)}`);
  }
  if (!Array.isArray(list.value)) {
    const reason =
      `Step ${at.step.id} runs over ${at.step.foreach}, ` + `which is ${describeValue(list.value)}, not a list.`;
    return refuse(walk, start, reason);
  }
  const items: readonly Json[] = list.value.map((item: unknown) => toJson(item));
  if (record === undefined) {
    await startRecord(walk, { key: at.key, kind: "foreach", input: items, detail: null });
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
    const within = foreachItemKey(loop.at.key, index);
    const inner = { ...scope, within, outputs: new Map(scope.outputs), item };
    const progress = await runWorkflowSteps(walk, inner, { steps: loop.at.step.steps, start: item });
    if (progress.status !== "done") {
      return concludeComposite(walk, {
        key: loop.at.key,
        progress: progress,
        spent: subtractSpend(scope.budget.spent, before),
      });
    }
    outputs.push(progress.output);
  }
  return concludeComposite(walk, {
    key: loop.at.key,
    progress: done(outputs),
    spent: subtractSpend(scope.budget.spent, before),
  });
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
    const progress = await runWorkflowStep(walk, scope, {
      step,
      key: workflowStepKey(scope.within, step.id),
      previous,
    });
    if (progress.status !== "done") {
      return progress;
    }
    scope.outputs.set(step.id, progress.output);
    previous = progress.output;
  }
  return done(previous);
}
