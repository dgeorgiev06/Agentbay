import { failedWith, succeededWith, type Outcome, type Problem } from "../outcome.ts";
import { decisionRefusal } from "./choices.ts";
import { kernelDatabaseFile, type RunWithSteps, type StepRecord, type StoredState } from "./run-store.ts";
import type { ApprovalDecision } from "./run-state.ts";
import { startedSkillOf, type StartedSkill } from "./skill-steps.ts";
import type { ApprovalVerdict } from "./step-detail.ts";
import { skillRoundOf } from "./step-key.ts";

type StartedApproval = Extract<StepRecord, { readonly kind: "approval"; readonly status: "started" }>;

export function refusal(runId: string, wording: { readonly message: string; readonly fix?: string }): Outcome<never> {
  const problem: Problem = { file: kernelDatabaseFile, path: `/runs/${runId}`, ...wording };
  return failedWith([problem]);
}

export function refusalOf(runId: string, problems: readonly Problem[]): Outcome<never> {
  return failedWith(
    problems.map(({ message, fix }) => ({
      file: kernelDatabaseFile,
      path: `/runs/${runId}`,
      message,
      ...(fix === undefined ? {} : { fix }),
    })),
  );
}

function describeState(state: StoredState): string {
  switch (state.status) {
    case "running":
      return "running (resume it if no engine is advancing it)";
    case "waiting":
      return `waiting for ${state.reason} at step ${state.stepKey}`;
    case "done":
    case "failed":
    case "undone":
      return state.status;
  }
}

export function endedRefusal(run: RunWithSteps): Outcome<never> | undefined {
  const status = run.state.status;
  if (status !== "done" && status !== "failed" && status !== "undone") {
    return undefined;
  }
  return refusal(run.id, { message: `Run ${run.id} has ended (${status}); nothing more can be done with it.` });
}

function waitingRefusal(run: RunWithSteps, expected: { reason: string; stepKey: string }): Outcome<never> | undefined {
  const state = run.state;
  if (state.status === "waiting" && state.reason === expected.reason && state.stepKey === expected.stepKey) {
    return undefined;
  }
  return refusal(run.id, {
    message:
      `Run ${run.id} is not waiting for ${expected.reason} at step ${expected.stepKey}; ` +
      `it is ${describeState(state)}.`,
    fix: "Act on the step the run is waiting for, as resume shows it.",
  });
}

function recordAt(run: RunWithSteps, key: string): StepRecord | undefined {
  return run.steps.find((step) => step.key === key);
}

export function waitingSkill(run: RunWithSteps, stepKey: string): Outcome<StartedSkill> {
  const refused = endedRefusal(run) ?? waitingRefusal(run, { reason: "skill", stepKey });
  if (refused !== undefined) {
    return refused;
  }
  const round = skillRoundOf(stepKey);
  const record = startedSkillOf(round === undefined ? undefined : recordAt(run, round.step));
  if (record !== undefined && record.detail.submission === undefined && record.detail.round === round?.round) {
    return succeededWith(record);
  }
  return refusal(run.id, {
    message: `Run ${run.id} already has a submission for ${stepKey}; it is applied once.`,
    fix: "Submit once per round, to the step key the waiting run shows.",
  });
}

function startedApprovalOf(record: StepRecord | undefined): StartedApproval | undefined {
  return record?.kind === "approval" && record.status === "started" ? record : undefined;
}

export function verdictOf(decision: ApprovalDecision): ApprovalVerdict {
  const { by } = decision;
  switch (decision.decision) {
    case "approve":
    case "reject":
      return { decision: decision.decision, by };
    case "choice":
      return { decision: decision.decision, choice: decision.choice, by };
  }
}

export function answeredApproval(
  run: RunWithSteps,
  stepKey: string,
  decision: ApprovalDecision,
): Outcome<StartedApproval> {
  const found = waitingApproval(run, stepKey, decision.hash);
  if (!found.ok) {
    return found;
  }
  const { detail, input } = found.value;
  const refused = decisionRefusal(stepKey, detail.choices, { answer: decision, shown: detail.shown ?? input });
  return refused === undefined ? found : refusal(run.id, { message: refused });
}

function waitingApproval(run: RunWithSteps, stepKey: string, hash: string): Outcome<StartedApproval> {
  const refused = endedRefusal(run) ?? waitingRefusal(run, { reason: "approval", stepKey });
  const record = startedApprovalOf(recordAt(run, stepKey));
  if (refused !== undefined || record === undefined) {
    return refused ?? refusal(run.id, { message: `Run ${run.id} has no waiting approval ${stepKey}.` });
  }
  if (record.detail.verdict !== undefined) {
    return refusal(run.id, {
      message: `Step ${stepKey} of run ${run.id} already has a decision; it is applied once.`,
      fix: "Resume the run to apply the recorded decision.",
    });
  }
  const shownHash = record.detail.hash;
  if (shownHash === hash) {
    return succeededWith(record);
  }
  return refusal(run.id, {
    message: `The hash ${hash} is not the hash of what step ${stepKey} showed (${shownHash}).`,
    fix:
      record.detail.choices === undefined
        ? "Approve or reject exactly what the waiting approval shows, naming its hash."
        : "Take one of the choices the waiting approval offers, naming the hash it shows.",
  });
}
