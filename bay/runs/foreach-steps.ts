import { subtractSpend } from "./budget.ts";
import type { Json } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import { toJson } from "../json.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import { runSideBySide } from "./side-by-side-steps.ts";
import { foreachItemKey } from "./step-key.ts";
import { concludeComposite, done, refuse, startRecord, type Progress, type Walk } from "./walk.ts";
import {
  referenceScope,
  type StepAt,
  type StepsRunner,
  type UnsettledStep,
  type WorkflowScope,
} from "./workflow-scope.ts";

type ForeachStep = Extract<WorkflowStep, { readonly foreach: string }>;

type ForeachAt = UnsettledStep<ForeachStep> & {
  readonly runSteps: StepsRunner;
};

type Loop = {
  readonly at: StepAt<ForeachStep>;
  readonly items: readonly Json[];
  readonly runSteps: StepsRunner;
};

const fewestSideBySide = 2;

const mostSideBySide = 8;

function describeValue(value: Json): string {
  if (value === null || typeof value !== "object") {
    return `the value ${JSON.stringify(value)}`;
  }
  return Array.isArray(value) ? "a list" : "a mapping";
}

function checkedSideBySide(stepId: string, written: string, value: Json): Outcome<number> {
  if (typeof value === "number" && Number.isInteger(value) && value >= fewestSideBySide && value <= mostSideBySide) {
    return succeededWith(value);
  }
  const reason =
    `Step ${stepId} cannot run its items side by side: sideBySide is ${written}, which is ${describeValue(value)}; ` +
    `it must be a whole number from ${String(fewestSideBySide)} to ${String(mostSideBySide)}.`;
  return failedWith([unplacedProblem(reason)]);
}

function sideBySideOf(scope: WorkflowScope, step: ForeachStep): Outcome<number | undefined> {
  const written = step.sideBySide;
  if (typeof written !== "string") {
    return succeededWith(written);
  }
  const resolved = scope.workflow.resolve(written, referenceScope(scope));
  if (!resolved.ok) {
    const reason = `Step ${step.id} cannot run its items side by side: ${problemText(resolved.problems)}`;
    return failedWith([unplacedProblem(reason)]);
  }
  return checkedSideBySide(step.id, written, resolved.value);
}

export async function runForeach(walk: Walk, scope: WorkflowScope, at: ForeachAt): Promise<Progress> {
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
  const sideBySide = sideBySideOf(scope, at.step);
  if (!sideBySide.ok) {
    return refuse(walk, start, problemText(sideBySide.problems));
  }
  const items: readonly Json[] = list.value.map((item: unknown) => toJson(item));
  if (record === undefined) {
    await startRecord(walk, { key: at.key, kind: "foreach", input: items, detail: null });
  }
  const cap = sideBySide.value;
  if (cap === undefined) {
    return runItems(walk, scope, { at, items, runSteps: at.runSteps });
  }
  return runSideBySide(walk, scope, { at, items, runSteps: at.runSteps, cap, record: walk.records.get(at.key) });
}

async function runItems(walk: Walk, scope: WorkflowScope, loop: Loop): Promise<Progress> {
  const before = scope.budget.spent;
  const outputs: Json[] = [];
  for (const [index, item] of loop.items.entries()) {
    const within = foreachItemKey(loop.at.key, index);
    const inner = { ...scope, within, outputs: new Map(scope.outputs), keys: new Map(scope.keys), item };
    const progress = await loop.runSteps(walk, inner, { steps: loop.at.step.steps, start: item });
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
