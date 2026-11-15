import { join } from "node:path/posix";
import type { PolicyOf, SkillTask } from "./contracts.ts";
import { hashOf } from "./json.ts";
import type { System } from "./registry.ts";
import type { RunWithSteps, StepRecord } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { skillTaskOf, startedSkillOf } from "./skill-steps.ts";
import { skillRoundOf } from "./step-key.ts";
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

function recordOf(run: RunWithSteps, key: string): StepRecord | undefined {
  return run.steps.find((step) => step.key === key);
}

export function skillStepAt(context: WaitingContext, run: RunWithSteps, waitingKey: string): SkillStepAt | string {
  const round = skillRoundOf(waitingKey);
  const record = startedSkillOf(round === undefined ? undefined : recordOf(run, round.step));
  if (record === undefined) {
    return `Run ${run.id} has no skill step ${waitingKey}.`;
  }
  const { detail } = record;
  const target = resolveOwnAction(context.system, detail.mode, detail.action);
  if (typeof target === "string") {
    return target;
  }
  const permissions = { grants: context.policyOf(detail.mode), actionEffects: target.action.effects };
  const task = skillTaskOf({ runId: run.id, key: record.key, input: record.input, detail }, permissions);
  return { waitingKey, task, target, skillFile: join(target.mode.folder, detail.skill, "SKILL.md") };
}

function approvalWaiting(run: RunWithSteps, stepKey: string): Waiting | undefined {
  const record = recordOf(run, stepKey);
  const detail = record?.kind === "approval" ? record.detail : null;
  if (record === undefined || detail === null) {
    return undefined;
  }
  const shown = detail.shown ?? record.input;
  return {
    reason: "approval",
    stepKey,
    question: detail.question,
    hash: detail.hash,
    content: hashOf(shown) === detail.hash ? shown : null,
    ...(detail.previousHash === undefined ? {} : { previousHash: detail.previousHash }),
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
      return approvalWaiting(run, state.stepKey);
    case "time":
      return { reason: "time", stepKey: state.stepKey, until: state.until ?? "" };
    case "budget":
      return undefined;
    case "owner":
      return { reason: "owner", stepKey: state.stepKey, question: ownerQuestion };
  }
}
