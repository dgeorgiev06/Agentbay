import { join } from "node:path/posix";
import type { PolicyOf, SkillTask } from "./contracts.ts";
import type { Step as WorkflowStep } from "./generated/workflow.ts";
import { fieldOf, hashOf, numberField, textField, textsField } from "./json.ts";
import type { System } from "./registry.ts";
import type { RunWithSteps, StepRecord } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { resolveOwnAction, type ActionTarget } from "./targets.ts";

export type SkillStepAt = {
  readonly waitingKey: string;
  readonly task: SkillTask;
  readonly target: ActionTarget;
  readonly skillFile: string;
};

export type WaitingContext = {
  readonly system: System;
  readonly policyOf: PolicyOf;
};

type StepPosition = {
  readonly parentKey: string | undefined;
  readonly index: number;
};

function positionOf(key: string): StepPosition {
  const slash = key.lastIndexOf("/");
  if (slash < 0) {
    return { parentKey: undefined, index: Number(key) };
  }
  return { parentKey: key.slice(0, slash), index: Number(key.slice(slash + 1)) };
}

function recordOf(run: RunWithSteps, key: string): StepRecord | undefined {
  return run.steps.find((step) => step.key === key);
}

function actionOfPosition(context: WaitingContext, run: RunWithSteps, position: StepPosition): ActionTarget | string {
  if (position.parentKey === undefined) {
    if (run.target.kind !== "action") {
      return `Run ${run.id} is a workflow, and a workflow has no skill step of its own.`;
    }
    return resolveOwnAction(context.system, run.target.mode, run.target.name);
  }
  const parent = recordOf(run, position.parentKey);
  const mode = parent === undefined ? undefined : textField(parent.detail, "mode");
  const action = parent === undefined ? undefined : textField(parent.detail, "action");
  if (mode === undefined || action === undefined) {
    return `Run ${run.id} has no record of the action that holds step ${position.parentKey}.`;
  }
  return resolveOwnAction(context.system, mode, action);
}

export function skillStepAt(context: WaitingContext, run: RunWithSteps, waitingKey: string): SkillStepAt | string {
  const key = waitingKey.slice(0, waitingKey.lastIndexOf("#"));
  const record = recordOf(run, key);
  if (record?.kind !== "skill") {
    return `Run ${run.id} has no skill step ${waitingKey}.`;
  }
  const position = positionOf(key);
  const target = actionOfPosition(context, run, position);
  if (typeof target === "string") {
    return target;
  }
  const step = target.action.run[position.index];
  if (step === undefined || !("skill" in step)) {
    return `Step ${String(position.index)} of action ${target.name} is not a skill step.`;
  }
  const mode = target.mode.manifest.name;
  const task: SkillTask = {
    place: { runId: run.id, mode, action: target.name, stepIndex: position.index, stepKey: key },
    skill: step.skill,
    tier: step.tier,
    input: record.input,
    outputSchema: textsField(record.detail, "schemas")[0] ?? "",
    permissions: { grants: context.policyOf(mode), actionEffects: target.action.effects },
    round: numberField(record.detail, "round") ?? 1,
    feedback: textsField(record.detail, "feedback"),
  };
  return { waitingKey, task, target, skillFile: join(target.mode.folder, step.skill, "SKILL.md") };
}

function stepIdOf(stepKey: string): string {
  return stepKey.slice(stepKey.lastIndexOf(".") + 1);
}

function findWorkflowStep(steps: readonly WorkflowStep[], id: string): WorkflowStep | undefined {
  for (const step of steps) {
    if (step.id === id) {
      return step;
    }
    const nested = "foreach" in step ? findWorkflowStep(step.steps, id) : undefined;
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function approvalQuestion(context: WaitingContext, run: RunWithSteps, stepKey: string): string {
  const workflow = context.system.modes.get(run.target.mode)?.workflows.get(run.target.name);
  const step = workflow === undefined ? undefined : findWorkflowStep(workflow.steps, stepIdOf(stepKey));
  return step !== undefined && "approval" in step ? step.approval : "";
}

function approvalWaiting(context: WaitingContext, run: RunWithSteps, stepKey: string): Waiting | undefined {
  const record = recordOf(run, stepKey);
  const hash = record === undefined ? undefined : textField(record.detail, "hash");
  if (record === undefined || hash === undefined) {
    return undefined;
  }
  const previousHash = textField(record.detail, "previousHash");
  const shown = fieldOf(record.detail, "shown") ?? record.input;
  const content = hashOf(shown) === hash ? shown : null;
  return {
    reason: "approval",
    stepKey,
    question: approvalQuestion(context, run, stepKey),
    hash,
    content,
    ...(previousHash === undefined ? {} : { previousHash }),
  };
}

const ownerQuestion =
  "The step started and did not finish, and its action has effects other than read, so running it again could " +
  "repeat them. Resume with --rerun to run it again.";

export function storedWaiting(context: WaitingContext, run: RunWithSteps): Waiting | undefined {
  const state = run.state;
  if (state.status !== "waiting") {
    return undefined;
  }
  switch (state.reason) {
    case "skill": {
      const found = skillStepAt(context, run, state.stepKey);
      return typeof found === "string" ? undefined : { reason: "skill", stepKey: state.stepKey, task: found.task };
    }
    case "approval":
      return approvalWaiting(context, run, state.stepKey);
    case "time":
      return { reason: "time", stepKey: state.stepKey, until: state.until ?? "" };
    case "budget":
      return undefined;
    case "owner":
      return { reason: "owner", stepKey: state.stepKey, question: ownerQuestion };
  }
}
