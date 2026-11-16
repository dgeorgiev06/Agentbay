import type { PolicyOf, Scrubber, SkillTask } from "../contracts.ts";
import type { System } from "../registry.ts";
import type { RunWithSteps, StepRecord } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { approvalContentOf } from "./scrubbed-store.ts";
import { skillTaskOf, startedSkillOf } from "./skill-steps.ts";
import { skillRoundOf } from "./step-key.ts";
import { resolveOwnAction } from "../targets.ts";

type WaitingContext = {
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly scrubber: Scrubber;
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

function approvalWaiting(context: WaitingContext, run: RunWithSteps, stepKey: string): Waiting | undefined {
  const record = recordOf(run, stepKey);
  const detail = record?.kind === "approval" ? record.detail : null;
  if (record === undefined || detail === null) {
    return undefined;
  }
  const shown = approvalContentOf(detail.shown ?? record.input, context.scrubber);
  return {
    reason: "approval",
    stepKey,
    question: detail.question,
    hash: detail.hash,
    content: shown.hash === detail.hash ? shown.content : null,
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
      return approvalWaiting(context, run, state.stepKey);
    case "time":
      return { reason: "time", stepKey: state.stepKey, until: state.until ?? "" };
    case "budget":
      return undefined;
    case "owner":
      return { reason: "owner", stepKey: state.stepKey, question: ownerQuestion };
  }
}
