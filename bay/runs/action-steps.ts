import {
  addSpend,
  charge,
  childFrame,
  frameAfterMinutes,
  frameRemaining,
  noSpend,
  subtractSpend,
  type BudgetFrame,
} from "./budget.ts";
import {
  defaultScriptTimeLimitSeconds,
  type ActionCaller,
  type Json,
  type Permissions,
  type RunEvent,
  type ScriptRequest,
  type Settled,
  type Spend,
  type StepOutcome,
  type StepPlace,
  type StepTimeLimit,
  type Submission,
  type Tier,
} from "../contracts.ts";
import type { Budget, Step } from "../generated/mode.ts";
import { fieldOf, textField } from "../json.ts";
import { problemText } from "../outcome.ts";
import { keepingOf, type SkillOutputKeeping } from "./packed-output.ts";
import type { StepRecord } from "./run-store.ts";
import { skillSchemas, skillTaskOf, startedSkillOf, type SkillAt } from "./skill-steps.ts";
import type { ScriptDetail, SkillDetail } from "./step-detail.ts";
import { actionEndKey, actionStepKey, checkStepKey, scriptCallKey } from "./step-key.ts";
import type { ActionTarget, ActiveMode } from "../manifests/manifests.ts";
import {
  changeDetail,
  concludeComposite,
  done,
  endRecord,
  eventOf,
  failed,
  gate,
  refuse,
  replayed,
  startRecord,
  stopGate,
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
  readonly events?: readonly RunEvent[];
};

type StepOf =
  | { readonly kind: "script"; readonly script: string }
  | { readonly kind: "skill"; readonly skill: string; readonly tier: Tier; readonly checks: readonly string[] }
  | { readonly kind: "call"; readonly call: string };

type ScriptLeaf = {
  readonly key: string;
  readonly kind: "script" | "check";
  readonly script: string;
  readonly input: Json;
  readonly place: StepPlace;
  readonly kept: SkillOutputKeeping;
  readonly skillInput?: Json;
};

type HeldWait = {
  waiting: Progress | undefined;
};

type StoppedAttempt = {
  readonly leaf: ScriptLeaf;
  readonly detail: ScriptDetail;
  readonly outcome: StepOutcome;
  readonly waiting: Progress;
};

type SkillStep = {
  readonly key: string;
  readonly skill: string;
  readonly tier: Tier;
  readonly checks: readonly string[];
  readonly input: Json;
  readonly place: StepPlace;
  readonly last: boolean;
};

type CallStep = {
  readonly key: string;
  readonly call: string;
  readonly input: Json;
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

function frameLabel(frame: ActionFrame): string {
  return `action ${frame.name} of mode ${frame.mode.manifest.name}`;
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

function scriptDetailOf(record: StepRecord | undefined): ScriptDetail | undefined {
  if (record === undefined || (record.kind !== "script" && record.kind !== "check")) {
    return undefined;
  }
  return record.detail ?? undefined;
}

function nestedCallerOf(record: StepRecord): string | undefined {
  const nested = record.kind === "call" || record.kind === "action" || record.kind === "undo";
  return nested ? record.detail?.caller : undefined;
}

function mayRerun(walk: Walk, frame: ActionFrame): boolean {
  return walk.rerunUnfinished || frame.action.effects.every((effect) => effect === "read");
}

function unfinishedWaiting(frame: ActionFrame, key: string): Progress {
  return waiting({
    reason: "owner",
    stepKey: key,
    question:
      `Step ${key} started and did not finish, and ${frameLabel(frame)} has the effects ` +
      `${frame.action.effects.join(", ")}, so running it again could repeat them. ` +
      "Resume with rerunUnfinished to run it again, or stop the run.",
  });
}

function calledOutcome(progress: Progress, reference: string, spent: Spend): StepOutcome {
  switch (progress.status) {
    case "done":
      return { status: "done", output: progress.output, spent };
    case "failed":
      return { status: "failed", reason: progress.reason, spent };
    case "waiting":
      return {
        status: "failed",
        reason:
          `${reference} stopped to wait for ${progress.waiting.reason}; ` +
          "this step stops too and runs again when the run resumes, with its finished calls replayed.",
        spent,
      };
  }
}

type ScriptAt = {
  readonly leaf: ScriptLeaf;
  readonly held: HeldWait;
  readonly startedAt: Date;
};

function minutesSince(walk: Walk, time: Date): number {
  return (walk.services.clock.now().getTime() - time.getTime()) / 60_000;
}

function actionCaller(walk: Walk, frame: ActionFrame, at: ScriptAt): ActionCaller {
  let count = 0;
  return async (reference, input) => {
    const key = scriptCallKey(at.leaf.key, count);
    count += 1;
    const before = frame.budget.spent;
    const budget = frameAfterMinutes(frame.budget, minutesSince(walk, at.startedAt));
    const progress = await runCall(walk, { ...frame, budget }, { key, call: reference, input });
    if (progress.status === "waiting") {
      at.held.waiting ??= progress;
    }
    return calledOutcome(progress, reference, subtractSpend(frame.budget.spent, before));
  };
}

function actionPermissions(walk: Walk, frame: ActionFrame): Permissions {
  return { grants: frame.mode.grants, actionEffects: frame.action.effects };
}

function ownTimeLimit(frame: ActionFrame, leaf: ScriptLeaf): StepTimeLimit {
  const declared = leaf.kind === "script" ? frame.action.scriptTimeLimitSeconds : undefined;
  if (declared === undefined) {
    return { timeLimitMilliseconds: defaultScriptTimeLimitSeconds * 1000, timeLimitSetBy: "kernel" };
  }
  return { timeLimitMilliseconds: declared * 1000, timeLimitSetBy: "action" };
}

function stepTimeLimit(own: StepTimeLimit, remaining: Budget): StepTimeLimit {
  const minutes = remaining.minutes;
  if (minutes === undefined || minutes * 60_000 >= own.timeLimitMilliseconds) {
    return own;
  }
  return { timeLimitMilliseconds: Math.max(0, minutes * 60_000), timeLimitSetBy: "budget" };
}

function scriptRequest(walk: Walk, frame: ActionFrame, at: ScriptAt): ScriptRequest {
  const { leaf } = at;
  const remaining = frameRemaining(frame.budget);
  return {
    place: leaf.place,
    script: leaf.script,
    input: leaf.input,
    permissions: actionPermissions(walk, frame),
    settings: frame.mode.settings,
    remaining,
    ...stepTimeLimit(ownTimeLimit(frame, leaf), remaining),
    call: actionCaller(walk, frame, at),
    ...(frame.caller === undefined ? {} : { caller: frame.caller }),
    ...(leaf.skillInput === undefined ? {} : { skillInput: leaf.skillInput }),
  };
}

async function stopForCall(walk: Walk, stopped: StoppedAttempt): Promise<Progress> {
  const stoppedForCall = addSpend(stopped.detail.stoppedForCall ?? noSpend, stopped.outcome.spent);
  const detail = { ...stopped.detail, stoppedForCall };
  await changeDetail(walk, { key: stopped.leaf.key, kind: stopped.leaf.kind, detail });
  return stopped.waiting;
}

async function noteRerun(walk: Walk, leaf: ScriptLeaf): Promise<void> {
  const event = eventOf(walk, "step.started", { stepKey: leaf.key, kind: leaf.kind, rerun: true });
  await walk.services.store.append(event);
}

async function runScript(walk: Walk, frame: ActionFrame, leaf: ScriptLeaf): Promise<Progress> {
  const record = walk.records.get(leaf.key);
  const replay = replayed(frame.budget, record);
  if (replay !== undefined) {
    return replay;
  }
  const blocked = leaf.kind === "check" ? stopGate(walk) : gate(walk, frame.budget, leaf.key);
  if (blocked !== undefined) {
    return blocked;
  }
  const stoppedForCall = scriptDetailOf(record)?.stoppedForCall !== undefined;
  if (record !== undefined && !mayRerun(walk, frame) && !stoppedForCall) {
    return unfinishedWaiting(frame, leaf.key);
  }
  return attemptScript(walk, frame, { leaf, record });
}

async function startedScript(
  walk: Walk,
  at: { leaf: ScriptLeaf; record: StepRecord | undefined },
): Promise<ScriptDetail> {
  const { leaf, record } = at;
  const detail = scriptDetailOf(record) ?? { script: leaf.script };
  if (record !== undefined) {
    await noteRerun(walk, leaf);
    return detail;
  }
  await startRecord(walk, { key: leaf.key, kind: leaf.kind, input: leaf.input, kept: leaf.kept, detail });
  return detail;
}

async function attemptScript(
  walk: Walk,
  frame: ActionFrame,
  at: { leaf: ScriptLeaf; record: StepRecord | undefined },
): Promise<Progress> {
  const leaf = { ...at.leaf, input: at.record?.input ?? at.leaf.input };
  const detail = await startedScript(walk, { leaf, record: at.record });
  const startedAt = walk.services.clock.now();
  await walk.services.store.heartbeat(walk.writer, startedAt);
  const before = frame.budget.spent;
  charge(frame.budget, detail.stoppedForCall ?? noSpend);
  const held: HeldWait = { waiting: undefined };
  const outcome = await walk.services.runner.run(scriptRequest(walk, frame, { leaf, held, startedAt }));
  charge(frame.budget, outcome.spent);
  if (held.waiting !== undefined) {
    return stopForCall(walk, { leaf, detail, outcome, waiting: held.waiting });
  }
  return endRecord(walk, { ...outcome, key: leaf.key, spent: subtractSpend(frame.budget.spent, before) });
}

function skillWaiting(walk: Walk, frame: ActionFrame, at: SkillAt): Progress {
  const context = { folder: frame.mode.folder, permissions: actionPermissions(walk, frame), events: walk.events };
  const task = skillTaskOf(at, context);
  return waiting({ reason: "skill", stepKey: task.stepKey, task });
}

async function startSkill(walk: Walk, frame: ActionFrame, skill: SkillStep): Promise<Progress> {
  const schemas = await skillSchemas(frame, { skill: skill.skill, last: skill.last });
  if (typeof schemas === "string") {
    return refuse(walk, { key: skill.key, kind: "skill", input: skill.input }, schemas);
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
  const kept = keepingOf(frame.action);
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
    return refuse(walk, { key: skill.key, kind: "skill", input: record.input }, `Step ${skill.key} is not a skill.`);
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
    const kept = keepingOf(frame.action);
    const input = submission.output;
    const leaf = { key, kind: "check" as const, script: check, input, place, kept, skillInput: at.input };
    const progress = await runScript(walk, frame, leaf);
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
    const kept = keepingOf(nested.target.action);
    await startRecord(walk, { key: nested.key, kind: nested.kind, input, kept, detail }, nested.events ?? []);
  }
  const budget = childFrame(parent, nested.target.action.budget, walk.extra);
  const caller = record === undefined ? nested.caller : nestedCallerOf(record);
  const progress = await runActionFrame(walk, { ...nested.target, key: nested.key, budget, caller }, input);
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
  const start = { key: call.key, kind: "call" as const, input: call.input };
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
  return runNestedAction(walk, frame.budget, { key: call.key, kind: "call", target, input: call.input, caller });
}

type ActionStepAt = {
  readonly index: number;
  readonly step: Step;
  readonly input: Json;
};

function runActionStep(walk: Walk, frame: ActionFrame, at: ActionStepAt): Promise<Progress> {
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
    case "script":
      return runScript(walk, frame, {
        key,
        kind: "script",
        script: step.script,
        input: at.input,
        place,
        kept: "as-text",
      });
    case "skill":
      return runSkill(walk, frame, { ...step, key, input: at.input, place, last: at.index === run.length - 1 });
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
  return failed(`The output of ${frameLabel(frame)} does not match its schema: ${problemText(checked.problems)}`);
}

export async function runActionFrame(walk: Walk, frame: ActionFrame, input: Json): Promise<Progress> {
  const checked = frame.input.check(input);
  if (!checked.ok) {
    return failed(`The input of ${frameLabel(frame)} does not match its schema: ${problemText(checked.problems)}`);
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
