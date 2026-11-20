import { addSpend, charge, childFrame, noSpend, subtractSpend, type BudgetFrame } from "./budget.ts";
import type { Json, RunEvent, Settled, Spend, StepPlace, Submission, Tier } from "../contracts.ts";
import type { Keeping, Step } from "../generated/mode.ts";
import { fieldOf, textField } from "../json.ts";
import { problemText, type Problem } from "../outcome.ts";
import { callsKeepingOf, eitherKeeping, keepingOf, withheldReason } from "./packed-output.ts";
import type { StepRecord } from "./run-store.ts";
import { actionPermissions, frameLabel, runScript, type CallStep } from "./script-steps.ts";
import { skillSchemas, skillTaskOf, startedSkillOf, type SkillAt } from "./skill-steps.ts";
import type { SkillDetail } from "./step-detail.ts";
import { actionEndKey, actionStepKey, checkStepKey } from "./step-key.ts";
import type { ActionTarget, ActiveMode } from "../manifests/manifests.ts";
import {
  changeDetail,
  concludeComposite,
  done,
  endRecord,
  failed,
  gate,
  refuse,
  replayed,
  startRecord,
  waiting,
  type ActionFrame,
  type Progress,
  type Walk,
} from "./walk.ts";

const maximumRounds = 3;

type NestedAction = {
  readonly key: string;
  readonly kind: "call" | "action" | "undo";
  readonly target: ActionTarget;
  readonly input: Json;
  readonly caller: string | undefined;
  readonly within: Keeping;
  readonly events?: readonly RunEvent[];
};

type StepOf =
  | { readonly kind: "script"; readonly script: string }
  | { readonly kind: "skill"; readonly skill: string; readonly tier: Tier; readonly checks: readonly string[] }
  | { readonly kind: "call"; readonly call: string };

type SkillStep = {
  readonly key: string;
  readonly skill: string;
  readonly tier: Tier;
  readonly checks: readonly string[];
  readonly input: Json;
  readonly place: StepPlace;
  readonly last: boolean;
};

type Attempt = {
  readonly skill: SkillStep;
  readonly at: SkillAt;
  readonly submission: Submission;
  readonly before: Spend;
};

type Verdict =
  | { readonly kind: "passed" }
  | { readonly kind: "failed"; readonly feedback: string }
  | { readonly kind: "broken"; readonly reason: string };

function ownKeeping(frame: ActionFrame): Keeping {
  return eitherKeeping(frame.within, keepingOf(frame.action));
}

function problemsCounted(problems: readonly Problem[]): string {
  return problems.length === 1 ? "1 problem" : `${String(problems.length)} problems`;
}

function mismatchReason(frame: ActionFrame, side: "input" | "output", problems: readonly Problem[]): string {
  const opening = `The ${side} of ${frameLabel(frame)} does not match its schema`;
  switch (frame.within) {
    case "as-text":
      return `${opening}: ${problemText(problems)}`;
    case "kept-packed":
      return `${opening}: ${problemsCounted(problems)}, not shown, since the kernel keeps the ${side} packed.`;
  }
}

function handedUp(frame: ActionFrame, what: string, progress: Progress): Progress {
  return progress.status === "failed" && frame.within === "kept-packed" ? failed(withheldReason(what)) : progress;
}

function stepOf(step: Step): StepOf {
  if ("script" in step) {
    return { kind: "script", script: step.script };
  }
  if ("skill" in step) {
    return { kind: "skill", skill: step.skill, tier: step.tier, checks: step.checks ?? [] };
  }
  return { kind: "call", call: step.call };
}

function nestedCallerOf(record: StepRecord): string | undefined {
  const nested = record.kind === "call" || record.kind === "action" || record.kind === "undo";
  return nested ? record.detail?.caller : undefined;
}

function skillWaiting(walk: Walk, frame: ActionFrame, at: SkillAt): Progress {
  const context = { folder: frame.mode.folder, permissions: actionPermissions(walk, frame), events: walk.events };
  const task = skillTaskOf(at, context);
  return waiting({ reason: "skill", stepKey: task.stepKey, task });
}

async function startSkill(walk: Walk, frame: ActionFrame, skill: SkillStep): Promise<Progress> {
  const schemas = await skillSchemas(frame, { skill: skill.skill, last: skill.last });
  const kept = ownKeeping(frame);
  if (typeof schemas === "string") {
    return refuse(walk, { key: skill.key, kind: "skill", input: skill.input, kept }, schemas);
  }
  const detail: SkillDetail = {
    mode: frame.mode.manifest.name,
    action: frame.name,
    skill: skill.skill,
    tier: skill.tier,
    schemas,
    round: 1,
    feedback: [],
    earlierSpent: noSpend,
    calledSpent: noSpend,
  };
  const started = await startRecord(walk, { key: skill.key, kind: "skill", input: skill.input, kept, detail });
  return skillWaiting(walk, frame, { runId: walk.writer.runId, key: skill.key, input: started.input, detail });
}

function chargeEarlierRounds(walk: Walk, frame: ActionFrame, at: { skill: SkillStep; round: number }): void {
  const { skill, round } = at;
  for (let earlier = 1; earlier < round; earlier += 1) {
    for (const index of skill.checks.keys()) {
      replayed(frame.budget, walk.records.get(checkStepKey(skill.key, earlier, index)));
    }
  }
}

async function runSkill(walk: Walk, frame: ActionFrame, skill: SkillStep): Promise<Progress> {
  const record = walk.records.get(skill.key);
  const replay = replayed(frame.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const blocked = gate(walk, frame.budget, skill.key);
  if (blocked !== undefined) {
    return blocked;
  }
  if (record === undefined) {
    return startSkill(walk, frame, skill);
  }
  const started = startedSkillOf(record);
  if (started === undefined) {
    const start = { key: skill.key, kind: "skill" as const, input: record.input, kept: ownKeeping(frame) };
    return refuse(walk, start, `Step ${skill.key} is not a skill.`);
  }
  const before = frame.budget.spent;
  const detail = started.detail;
  chargeEarlierRounds(walk, frame, { skill, round: detail.round });
  charge(frame.budget, addSpend(detail.earlierSpent, detail.calledSpent));
  const at = { runId: walk.writer.runId, key: skill.key, input: started.input, detail };
  if (detail.submission === undefined) {
    return skillWaiting(walk, frame, at);
  }
  charge(frame.budget, detail.submission.spent);
  return runChecks(walk, frame, { skill, at, submission: detail.submission, before });
}

function verdictOf(check: string, progress: Settled): Verdict {
  if (progress.status === "failed") {
    return { kind: "broken", reason: `The check ${check} failed to run: ${progress.reason}` };
  }
  const passed = fieldOf(progress.output, "passed");
  const feedback = textField(progress.output, "feedback");
  if (passed === true) {
    return { kind: "passed" };
  }
  if (passed === false && feedback !== undefined) {
    return { kind: "failed", feedback };
  }
  return {
    kind: "broken",
    reason: `The check ${check} returned neither { "passed": true } nor { "passed": false, "feedback": "..." }.`,
  };
}

async function runChecks(walk: Walk, frame: ActionFrame, attempt: Attempt): Promise<Progress> {
  const { skill, at, submission } = attempt;
  const feedback: string[] = [];
  for (const [index, check] of skill.checks.entries()) {
    const key = checkStepKey(skill.key, at.detail.round, index);
    const place = { ...skill.place, stepKey: key };
    const kept = ownKeeping(frame);
    const input = submission.output;
    const leaf = { key, kind: "check" as const, script: check, input, place, kept, skillInput: at.input };
    const progress = await runScript(walk, frame, { leaf, calls: runCall });
    if (progress.status === "waiting") {
      return progress;
    }
    const verdict = verdictOf(check, progress);
    if (verdict.kind === "broken") {
      const spent = subtractSpend(frame.budget.spent, attempt.before);
      return endRecord(walk, { key: skill.key, status: "failed", reason: verdict.reason, spent });
    }
    if (verdict.kind === "failed") {
      feedback.push(verdict.feedback);
    }
  }
  return concludeRound(walk, frame, { attempt, feedback });
}

function nextRound(detail: SkillDetail, feedback: readonly string[], submission: Submission): SkillDetail {
  return {
    mode: detail.mode,
    action: detail.action,
    skill: detail.skill,
    tier: detail.tier,
    schemas: detail.schemas,
    round: detail.round + 1,
    feedback,
    earlierSpent: addSpend(detail.earlierSpent, submission.spent),
    calledSpent: detail.calledSpent,
    ...(detail.calledRuns === undefined ? {} : { calledRuns: detail.calledRuns }),
  };
}

async function concludeRound(
  walk: Walk,
  frame: ActionFrame,
  result: { readonly attempt: Attempt; readonly feedback: readonly string[] },
): Promise<Progress> {
  const { attempt, feedback } = result;
  const { skill, at, submission } = attempt;
  const spent = subtractSpend(frame.budget.spent, attempt.before);
  if (feedback.length === 0) {
    return endRecord(walk, { key: skill.key, status: "done", output: submission.output, spent });
  }
  if (at.detail.round >= maximumRounds) {
    const reason =
      `The output of the skill ${skill.skill} failed its checks in round ${String(at.detail.round)}, ` +
      `the last round: ${feedback.join(" ")}`;
    return endRecord(walk, { key: skill.key, status: "failed", reason, spent });
  }
  const detail = nextRound(at.detail, feedback, submission);
  await changeDetail(walk, { key: skill.key, kind: "skill", detail });
  return skillWaiting(walk, frame, { ...at, detail });
}

export async function runNestedAction(walk: Walk, parent: BudgetFrame, nested: NestedAction): Promise<Progress> {
  const record = walk.records.get(nested.key);
  const replay = replayed(parent, record);
  if (replay !== undefined) {
    return replay;
  }
  const blocked = record === undefined ? gate(walk, parent, nested.key) : undefined;
  if (blocked !== undefined) {
    return blocked;
  }
  const before = parent.spent;
  const input = record?.input ?? nested.input;
  if (record === undefined) {
    const caller = nested.caller === undefined ? {} : { caller: nested.caller };
    const detail = { mode: nested.target.mode.manifest.name, action: nested.target.name, ...caller };
    const kept = eitherKeeping(nested.within, keepingOf(nested.target.action));
    await startRecord(walk, { key: nested.key, kind: nested.kind, input, kept, detail }, nested.events ?? []);
  }
  const budget = childFrame(parent, nested.target.action.budget, walk.extra);
  const caller = record === undefined ? nested.caller : nestedCallerOf(record);
  const frame = { ...nested.target, key: nested.key, budget, caller, within: nested.within };
  const progress = await runActionFrame(walk, frame, input);
  return concludeComposite(walk, { key: nested.key, progress: progress, spent: subtractSpend(parent.spent, before) });
}

export function nestedTarget(walk: Walk, from: ActiveMode, name: string): ActionTarget | string {
  const answer = walk.services.system.action(name, from.manifest.name);
  return answer.ok ? answer.value : problemText(answer.problems);
}

async function runCall(walk: Walk, frame: ActionFrame, call: CallStep): Promise<Progress> {
  const replay = replayed(frame.budget, walk.records.get(call.key));
  if (replay !== undefined) {
    return replay;
  }
  const within = callsKeepingOf(frame.action, frame.within);
  const start = { key: call.key, kind: "call" as const, input: call.input, kept: within };
  const target = nestedTarget(walk, frame.mode, call.call);
  if (typeof target === "string") {
    return refuse(walk, start, target);
  }
  const missing = target.action.effects.filter((effect) => !frame.action.effects.includes(effect));
  if (missing.length > 0) {
    const reason =
      `The ${frameLabel(frame)} calls ${call.call}, which has the effects ${missing.join(", ")} ` +
      `that ${frame.name} does not declare; the call is refused.`;
    return refuse(walk, start, reason);
  }
  const caller = target.caller;
  const nested = { key: call.key, kind: "call" as const, target, input: call.input, caller, within };
  return runNestedAction(walk, frame.budget, nested);
}

type ActionStepAt = {
  readonly index: number;
  readonly step: Step;
  readonly input: Json;
};

async function runActionStep(walk: Walk, frame: ActionFrame, at: ActionStepAt): Promise<Progress> {
  const run = frame.action.run;
  const step = stepOf(at.step);
  const key = actionStepKey(frame.key, at.index);
  const place: StepPlace = {
    runId: walk.writer.runId,
    mode: frame.mode.manifest.name,
    action: frame.name,
    stepKey: key,
  };
  switch (step.kind) {
    case "script": {
      const leaf = { key, kind: "script" as const, script: step.script, input: at.input, place, kept: frame.within };
      const what = `The script ${step.script} of ${frameLabel(frame)}`;
      return handedUp(frame, what, await runScript(walk, frame, { leaf, calls: runCall }));
    }
    case "skill": {
      const skill = { ...step, key, input: at.input, place, last: at.index === run.length - 1 };
      const what = `The skill ${step.skill} of ${frameLabel(frame)}`;
      return handedUp(frame, what, await runSkill(walk, frame, skill));
    }
    case "call":
      return runCall(walk, frame, { key, call: step.call, input: at.input });
  }
}

function frameOutput(walk: Walk, frame: ActionFrame, output: Json): Progress {
  const blocked = gate(walk, frame.budget, actionEndKey(frame.key));
  if (blocked !== undefined) {
    return blocked;
  }
  const checked = frame.output.check(output);
  if (checked.ok) {
    return done(output);
  }
  return failed(mismatchReason(frame, "output", checked.problems));
}

export async function runActionFrame(walk: Walk, frame: ActionFrame, input: Json): Promise<Progress> {
  const checked = frame.input.check(input);
  if (!checked.ok) {
    return failed(mismatchReason(frame, "input", checked.problems));
  }
  let value = input;
  for (const [index, step] of frame.action.run.entries()) {
    const progress = await runActionStep(walk, frame, { index, step, input: value });
    if (progress.status !== "done") {
      return progress;
    }
    value = progress.output;
  }
  return frameOutput(walk, frame, value);
}
