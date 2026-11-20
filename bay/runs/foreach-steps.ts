import { subtractSpend } from "./budget.ts";
import type { Json } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import { toJson } from "../json.ts";
import { problemText, succeededWith } from "../outcome.ts";
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

function describeValue(value: Json): string {
  if (value === null || typeof value !== "object") {
    return `the value ${JSON.stringify(value)}`;
  }
  return "a mapping";
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
  const items: readonly Json[] = list.value.map((item: unknown) => toJson(item));
  if (record === undefined) {
    await startRecord(walk, { key: at.key, kind: "foreach", input: items, detail: null });
  }
  return runItems(walk, scope, { at, items, runSteps: at.runSteps });
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
