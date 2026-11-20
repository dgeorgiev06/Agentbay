import { nestedTarget, runNestedAction } from "./action-steps.ts";
import { noSpend, subtractSpend, type BudgetFrame } from "./budget.ts";
import type { Json, Settled } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import { toJson } from "../json.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import type { ReferenceScope, WorkflowTarget } from "../manifests/manifests.ts";
import type { StepRecord } from "./run-store.ts";
import { checkedCard, type StepSeen } from "./card.ts";
import { evaluatedChoices, reasonProblems, shownChoices, type ChoiceStatus } from "./choices.ts";
import { approvalContentOf, type ApprovalContent } from "./scrubbed-store.ts";
import type { ApprovalDetail, ApprovalVerdict } from "./step-detail.ts";
import { foreachItemKey, workflowStepKey } from "./step-key.ts";
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
  readonly workflow: WorkflowTarget;
  readonly budget: BudgetFrame;
  readonly within: string;
  readonly trigger: Json;
  readonly outputs: Map<string, Json>;
  readonly keys: Map<string, string>;
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

type UnsettledStep<T> = StepAt<T> & {
  readonly record: StepRecord | undefined;
};

type Shown = ApprovalContent & {
  readonly detail: ApprovalDetail;
};

type ShownAt = {
  readonly step: ApprovalStep;
  readonly content: Json;
  readonly choices: readonly ChoiceStatus[] | undefined;
};

type Settling = {
  readonly at: StepAt<ApprovalStep>;
  readonly shown: Shown;
};

type ShownParts = Pick<ApprovalDetail, "choices" | "card">;

const unitMilliseconds: ReadonlyMap<string, number> = new Map([
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
]);

function referenceScope(scope: WorkflowScope): ReferenceScope {
  const base = { trigger: scope.trigger, outputs: scope.outputs };
  return scope.item === undefined ? base : { ...base, item: scope.item };
}

function durationMilliseconds(text: string): number {
  const unit = unitMilliseconds.get(text.slice(-1)) ?? 0;
  return Number(text.slice(0, -1)) * unit;
}

async function runWorkflowAction(walk: Walk, scope: WorkflowScope, at: UnsettledStep<ActionStep>): Promise<Progress> {
  const start = { key: at.key, kind: "action" as const, input: at.previous };
  const stepInput = at.step.input;
  const input =
    at.record !== undefined || stepInput === undefined
      ? succeededWith(at.previous)
      : scope.workflow.resolve(stepInput, referenceScope(scope));
  if (!input.ok) {
    return refuse(walk, start, `Step ${at.step.id} cannot start: ${problemText(input.problems)}`);
  }
  const target = nestedTarget(walk, scope.workflow.mode, at.step.action);
  if (typeof target === "string") {
    return refuse(walk, start, target);
  }
  const caller = target.caller;
  const nested = {
    key: at.key,
    kind: "action" as const,
    target,
    input: input.value,
    caller,
    within: "as-text" as const,
  };
  return runNestedAction(walk, scope.budget, nested);
}

function approvalWaiting(at: StepAt<ApprovalStep>, detail: ApprovalDetail, content: Json): Progress {
  const { previousHash, choices, card } = detail;
  return waiting({
    reason: "approval",
    stepKey: at.key,
    question: detail.question,
    hash: detail.hash,
    content,
    ...(previousHash === undefined ? {} : { previousHash }),
    ...(choices === undefined ? {} : { choices: shownChoices(choices, content) }),
    ...(card === undefined ? {} : { card }),
  });
}

function evaluatedRules(scope: WorkflowScope, step: ApprovalStep): Outcome<readonly ChoiceStatus[] | undefined> {
  if (step.choices === undefined) {
    return succeededWith(undefined);
  }
  const resolve = (rule: string): Outcome<Json> => scope.workflow.resolve(rule, referenceScope(scope));
  return evaluatedChoices({ stepId: step.id, choices: step.choices, resolve });
}

function stepsSeen(records: ReadonlyMap<string, StepRecord>): ReadonlyMap<string, StepSeen> {
  return new Map(
    [...records].map(([key, record]) => {
      const skill = record.kind === "skill" && record.detail !== null ? record.detail : undefined;
      return [key, { kind: record.kind, status: record.status, skill }];
    }),
  );
}

async function checkedShown(walk: Walk, scope: WorkflowScope, at: ShownAt): Promise<Outcome<ShownParts>> {
  const { step, content, choices } = at;
  const store = walk.services.store;
  const context = {
    stepId: step.id,
    quotes: step.quotes ?? [],
    keys: scope.keys,
    steps: stepsSeen(walk.records),
    events: await store.readEvents(walk.writer.runId),
    eventsOf: (runId: string) => store.readEvents(runId),
  };
  const card = await checkedCard(content, context);
  const reasons = choices === undefined ? [] : reasonProblems(step.id, choices, content);
  const problems = [...reasons.map((message) => unplacedProblem(message)), ...(card.ok ? [] : card.problems)];
  if (problems.length > 0 || !card.ok) {
    return failedWith(problems);
  }
  return succeededWith({
    ...(choices === undefined ? {} : { choices }),
    ...(card.value === undefined ? {} : { card: card.value }),
  });
}

function approvalDetailOf(record: StepRecord): ApprovalDetail | undefined {
  return record.kind === "approval" ? (record.detail ?? undefined) : undefined;
}

function decided(at: StepAt<ApprovalStep>, verdict: ApprovalVerdict, content: Json): Settled {
  switch (verdict.decision) {
    case "approve":
      return done(content);
    case "reject":
      return failed(`${verdict.by} rejected step ${at.step.id}: ${at.step.approval}`);
    case "choice":
      return done({ choice: verdict.choice, content });
  }
}

function recordedDetail(at: StepAt<ApprovalStep>, verdict: ApprovalVerdict, hash: string): Json {
  const { by } = verdict;
  switch (verdict.decision) {
    case "approve":
    case "reject":
      return { stepKey: at.key, hash, decision: verdict.decision, by };
    case "choice":
      return { stepKey: at.key, hash, decision: verdict.decision, choice: verdict.choice, by };
  }
}

async function settleApproval(walk: Walk, scope: WorkflowScope, settling: Settling): Promise<Progress> {
  const { at, shown } = settling;
  const recordedHash = shown.detail.hash;
  if (recordedHash !== shown.hash) {
    const { question, choices } = shown.detail;
    const parts = await checkedShown(walk, scope, { step: at.step, content: shown.content, choices });
    if (!parts.ok) {
      return refuse(walk, { key: at.key, kind: "approval", input: shown.content }, problemText(parts.problems));
    }
    const detail = { question, hash: shown.hash, previousHash: recordedHash, shown: shown.content, ...parts.value };
    await changeDetail(walk, { key: at.key, kind: "approval", detail });
    return approvalWaiting(at, detail, shown.content);
  }
  const verdict = shown.detail.verdict;
  if (verdict === undefined) {
    return approvalWaiting(at, shown.detail, shown.content);
  }
  const recorded = eventOf(walk, "approval.recorded", recordedDetail(at, verdict, shown.hash));
  const settled = decided(at, verdict, shown.content);
  return endRecord(walk, { ...settled, key: at.key, spent: noSpend }, [recorded]);
}

async function runApproval(walk: Walk, scope: WorkflowScope, at: UnsettledStep<ApprovalStep>): Promise<Progress> {
  const show = at.step.show;
  const content = show === undefined ? succeededWith(at.previous) : scope.workflow.resolve(show, referenceScope(scope));
  if (!content.ok) {
    const start = { key: at.key, kind: "approval" as const, input: at.previous };
    return refuse(walk, start, `Step ${at.step.id} cannot show anything: ${problemText(content.problems)}`);
  }
  const stopped = stopGate(walk);
  if (stopped !== undefined) {
    return stopped;
  }
  const shown = approvalContentOf(content.value, walk.services.scrubber);
  const detail = at.record === undefined ? undefined : approvalDetailOf(at.record);
  if (detail === undefined) {
    const start = { key: at.key, kind: "approval" as const, input: shown.content };
    const choices = evaluatedRules(scope, at.step);
    if (!choices.ok) {
      return refuse(walk, start, problemText(choices.problems));
    }
    const parts = await checkedShown(walk, scope, { step: at.step, content: shown.content, choices: choices.value });
    if (!parts.ok) {
      return refuse(walk, start, problemText(parts.problems));
    }
    const started = { question: at.step.approval, hash: shown.hash, ...parts.value };
    await startRecord(walk, { ...start, detail: started });
    return approvalWaiting(at, started, shown.content);
  }
  return settleApproval(walk, scope, { at, shown: { ...shown, detail } });
}

async function runWait(walk: Walk, at: UnsettledStep<WaitStep>): Promise<Progress> {
  const stopped = stopGate(walk);
  if (stopped !== undefined) {
    return stopped;
  }
  const until = new Date(walk.now.getTime() + durationMilliseconds(at.step.wait)).toISOString();
  const started =
    at.record ?? (await startRecord(walk, { key: at.key, kind: "wait", input: at.previous, detail: { until } }));
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

async function runForeach(walk: Walk, scope: WorkflowScope, at: UnsettledStep<ForeachStep>): Promise<Progress> {
  const { record } = at;
  const start = { key: at.key, kind: "foreach" as const, input: at.previous };
  const list =
    record === undefined ? scope.workflow.resolve(at.step.foreach, referenceScope(scope)) : succeededWith(record.input);
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
    const inner = { ...scope, within, outputs: new Map(scope.outputs), keys: new Map(scope.keys), item };
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

function runUnsettledStep(walk: Walk, scope: WorkflowScope, at: UnsettledStep<WorkflowStep>): Promise<Progress> {
  const of = workflowStepOf(at.step);
  switch (of.kind) {
    case "action":
      return runWorkflowAction(walk, scope, { ...at, step: of.step });
    case "approval":
      return runApproval(walk, scope, { ...at, step: of.step });
    case "wait":
      return runWait(walk, { ...at, step: of.step });
    case "foreach":
      return runForeach(walk, scope, { ...at, step: of.step });
  }
}

async function runWorkflowStep(walk: Walk, scope: WorkflowScope, at: StepAt<WorkflowStep>): Promise<Progress> {
  const record = walk.records.get(at.key);
  return replayed(scope.budget, record) ?? runUnsettledStep(walk, scope, { ...at, record });
}

export async function runWorkflowSteps(
  walk: Walk,
  scope: WorkflowScope,
  list: { readonly steps: readonly WorkflowStep[]; readonly start: Json },
): Promise<Progress> {
  let previous = list.start;
  for (const step of list.steps) {
    const key = workflowStepKey(scope.within, step.id);
    const progress = await runWorkflowStep(walk, scope, { step, key, previous });
    if (progress.status !== "done") {
      return progress;
    }
    scope.outputs.set(step.id, progress.output);
    scope.keys.set(step.id, key);
    previous = progress.output;
  }
  return done(previous);
}
