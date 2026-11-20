import type { BudgetFrame } from "./budget.ts";
import type { Json } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import type { ReferenceScope, WorkflowTarget } from "../manifests/manifests.ts";
import type { StepRecord } from "./run-store.ts";
import type { Progress, Walk } from "./walk.ts";

export type WorkflowScope = {
  readonly workflow: WorkflowTarget;
  readonly budget: BudgetFrame;
  readonly within: string;
  readonly trigger: Json;
  readonly outputs: Map<string, Json>;
  readonly keys: Map<string, string>;
  readonly item: Json | undefined;
};

export type StepAt<T> = {
  readonly step: T;
  readonly key: string;
  readonly previous: Json;
};

export type UnsettledStep<T> = StepAt<T> & {
  readonly record: StepRecord | undefined;
};

export type StepList = {
  readonly steps: readonly WorkflowStep[];
  readonly start: Json;
};

export type StepsRunner = (walk: Walk, scope: WorkflowScope, list: StepList) => Promise<Progress>;

export function referenceScope(scope: WorkflowScope): ReferenceScope {
  const base = { trigger: scope.trigger, outputs: scope.outputs };
  return scope.item === undefined ? base : { ...base, item: scope.item };
}
