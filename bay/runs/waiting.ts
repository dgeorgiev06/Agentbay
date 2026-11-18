import { measures, type RunEvent, type Scrubber } from "../contracts.ts";
import { numberField, textField } from "../json.ts";
import type { System } from "../manifests/manifests.ts";
import type { RunWithSteps, StepRecord } from "./run-store.ts";
import type { Waiting } from "./run-state.ts";
import { shownChoices } from "./choices.ts";
import { approvalContentOf } from "./scrubbed-store.ts";
import { skillTaskOf, startedSkillOf } from "./skill-steps.ts";
import { skillRoundOf } from "./step-key.ts";

type WaitingContext = {
  readonly system: System;
  readonly scrubber: Scrubber;
};

type Stored = {
  readonly run: RunWithSteps;
  readonly events: readonly RunEvent[];
};

function recordOf(run: RunWithSteps, key: string): StepRecord | undefined {
  return run.steps.find((step) => step.key === key);
}

function skillWaiting(context: WaitingContext, stored: Stored, waitingKey: string): Waiting | undefined {
  const { run, events } = stored;
  const round = skillRoundOf(waitingKey);
  const record = startedSkillOf(round === undefined ? undefined : recordOf(run, round.step));
  if (record === undefined) {
    return undefined;
  }
  const { detail } = record;
  const answer = context.system.action(`${detail.mode}.${detail.action}`);
  if (!answer.ok) {
    return undefined;
  }
  const target = answer.value;
  const permissions = { grants: target.mode.grants, actionEffects: target.action.effects };
  const at = { runId: run.id, key: record.key, input: record.input, detail };
  const task = skillTaskOf(at, { folder: target.mode.folder, permissions, events });
  return { reason: "skill", stepKey: waitingKey, task };
}

function approvalWaiting(context: WaitingContext, run: RunWithSteps, stepKey: string): Waiting | undefined {
  const record = recordOf(run, stepKey);
  const detail = record?.kind === "approval" ? record.detail : null;
  if (record === undefined || detail === null) {
    return undefined;
  }
  const shown = approvalContentOf(detail.shown ?? record.input, context.scrubber);
  const content = shown.hash === detail.hash ? shown.content : null;
  return {
    reason: "approval",
    stepKey,
    question: detail.question,
    hash: detail.hash,
    content,
    ...(detail.previousHash === undefined ? {} : { previousHash: detail.previousHash }),
    ...(detail.choices === undefined ? {} : { choices: shownChoices(detail.choices, content) }),
  };
}

function budgetWaiting(events: readonly RunEvent[], stepKey: string): Waiting | undefined {
  const exceeded = events.findLast(
    (event) => event.kind === "budget.exceeded" && textField(event.detail, "stepKey") === stepKey,
  );
  const detail = exceeded?.detail ?? null;
  const measure = measures.find((known) => known === textField(detail, "measure"));
  const limit = numberField(detail, "limit");
  const spent = numberField(detail, "spent");
  if (measure === undefined || limit === undefined || spent === undefined) {
    return undefined;
  }
  return { reason: "budget", stepKey, overrun: { measure, limit, spent } };
}

const ownerQuestion =
  "The step started and did not finish, and its action has effects other than read, so running it again could " +
  "repeat them. Resume with --rerun to run it again.";

export function storedWaiting(context: WaitingContext, stored: Stored): Waiting | undefined {
  const state = stored.run.state;
  if (state.status !== "waiting") {
    return undefined;
  }
  switch (state.reason) {
    case "skill":
      return skillWaiting(context, stored, state.stepKey);
    case "approval":
      return approvalWaiting(context, stored.run, state.stepKey);
    case "time":
      return { reason: "time", stepKey: state.stepKey, until: state.until ?? "" };
    case "budget":
      return budgetWaiting(stored.events, state.stepKey);
    case "owner":
      return { reason: "owner", stepKey: state.stepKey, question: ownerQuestion };
  }
}
