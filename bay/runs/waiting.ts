import type { PolicyOf, SkillTask } from "../contracts.ts";
import { hashOf } from "../json.ts";
import type { System } from "../registry.ts";
import type { RunWithSteps, StepRecord } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { skillTaskOf, startedSkillOf } from "./skill-steps.ts";
import { skillRoundOf } from "./step-key.ts";
import { resolveCall, resolveOwnAction, type ActionTarget } from "../targets.ts";

type WaitingContext = {
  readonly system: System;
  readonly policyOf: PolicyOf;
};

function recordOf(run: RunWithSteps, key: string): StepRecord | undefined {
  return run.steps.find((step) => step.key === key);
}

function skillTaskAt(context: WaitingContext, run: RunWithSteps, waitingKey: string): SkillTask | undefined {
  const round = skillRoundOf(waitingKey);
  const record = startedSkillOf(round === undefined ? undefined : recordOf(run, round.step));
  if (record === undefined) {
    return undefined;
  }
  const { detail } = record;
  const target = resolveOwnAction(context.system, detail.mode, detail.action);
  if (typeof target === "string") {
    return undefined;
  }
  const permissions = { grants: context.policyOf(detail.mode), actionEffects: target.action.effects };
  return skillTaskOf({ runId: run.id, key: record.key, input: record.input, detail }, permissions);
}

export function calledTarget(system: System, modeName: string, action: string): ActionTarget | string {
  const mode = system.modes.get(modeName);
  if (mode === undefined) {
    return `There is no mode ${modeName}.`;
  }
  return action.includes(".") ? resolveCall(system, mode, action) : resolveOwnAction(system, modeName, action);
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
      const task = skillTaskAt(context, run, state.stepKey);
      return task === undefined ? undefined : { reason: "skill", stepKey: state.stepKey, task };
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
