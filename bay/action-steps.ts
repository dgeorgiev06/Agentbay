import { join } from "node:path/posix";
import { charge, childFrame, frameRemaining, subtractSpend, type BudgetFrame } from "./budget.ts";
import type {
  ActionCaller,
  Json,
  RunEvent,
  ScriptRequest,
  SkillTask,
  Spend,
  StepOutcome,
  StepPlace,
  Tier,
} from "./contracts.ts";
import type { Step } from "./generated/mode.ts";
import { fieldOf, numberField, textField, textsField, withFields } from "./json.ts";
import type { StepRecord } from "./run-store.ts";
import { parseSkill, type Problem } from "./spec.ts";
import { resolveCall, type ActionTarget } from "./targets.ts";
import {
  changeDetail,
  concludeComposite,
  done,
  endRecord,
  eventOf,
  failed,
  gate,
  problemText,
  refuse,
  replayed,
  schemaProblems,
  startRecord,
  waiting,
  type ActionFrame,
  type Progress,
  type Services,
  type Settled,
  type Walk,
} from "./walk.ts";

const maximumRounds = 3;

export type NestedAction = {
  readonly key: string;
  readonly kind: "call" | "action" | "undo";
  readonly target: ActionTarget;
  readonly input: Json;
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
  readonly record: StepRecord;
  readonly round: number;
  readonly submitted: Json;
  readonly before: Spend;
};

type Verdict =
  | { readonly kind: "passed" }
  | { readonly kind: "failed"; readonly feedback: string }
  | { readonly kind: "broken"; readonly reason: string };

function frameLabel(frame: ActionFrame): string {
  return `action ${frame.name} of mode ${frame.mode.manifest.name}`;
}

function stepKeyOf(frame: ActionFrame, index: number): string {
  return frame.key === "" ? String(index) : `${frame.key}/${String(index)}`;
}

export function skillStepKey(key: string, round: number): string {
  return `${key}#${String(round)}`;
}

function checkKey(key: string, round: number, index: number): string {
  return `${skillStepKey(key, round)}.check${String(index)}`;
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

function settledOf(outcome: StepOutcome): Settled {
  switch (outcome.status) {
    case "done":
      return done(outcome.output);
    case "failed":
      return failed(outcome.reason);
  }
}

function calledOutcome(progress: Progress, reference: string, spent: Spend): StepOutcome {
  switch (progress.kind) {
    case "done":
      return { status: "done", output: progress.output, spent };
    case "failed":
      return { status: "failed", reason: progress.reason, spent };
    case "waiting":
      return {
        status: "failed",
        reason:
          `${reference} stopped to wait for ${progress.waiting.reason}, ` +
          "which an action called from a script cannot do.",
        spent,
      };
  }
}

function actionCaller(walk: Walk, frame: ActionFrame, scriptKey: string): ActionCaller {
  let count = 0;
  return async (reference, input) => {
    const key = `${scriptKey}.call${String(count)}`;
    count += 1;
    const before = frame.budget.spent;
    const progress = await runCall(walk, frame, { key, call: reference, input });
    return calledOutcome(progress, reference, subtractSpend(frame.budget.spent, before));
  };
}

function scriptRequest(walk: Walk, frame: ActionFrame, leaf: ScriptLeaf): ScriptRequest {
  return {
    place: leaf.place,
    script: leaf.script,
    input: leaf.input,
    permissions: walk.services.policyOf(frame.mode.manifest.name),
    settings: frame.mode.settings,
    remaining: frameRemaining(frame.budget),
    call: actionCaller(walk, frame, leaf.key),
  };
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
  const blocked = gate(walk, frame.budget, leaf.key);
  if (blocked !== undefined) {
    return blocked;
  }
  if (record !== undefined && !mayRerun(walk, frame)) {
    return unfinishedWaiting(frame, leaf.key);
  }
  const input = record?.input ?? leaf.input;
  if (record === undefined) {
    await startRecord(walk, { key: leaf.key, kind: leaf.kind, input, detail: { script: leaf.script } });
  } else {
    await noteRerun(walk, leaf);
  }
  await walk.services.store.heartbeat(walk.writer, walk.services.clock.now());
  const before = frame.budget.spent;
  const outcome = await walk.services.runner.run(scriptRequest(walk, frame, { ...leaf, input }));
  charge(frame.budget, outcome.spent);
  const spent = subtractSpend(frame.budget.spent, before);
  return endRecord(walk, { key: leaf.key, settled: settledOf(outcome), spent });
}

async function skillSchemas(
  services: Services,
  frame: ActionFrame,
  skill: SkillStep,
): Promise<readonly string[] | string> {
  const file = join(frame.mode.folder, skill.skill, "SKILL.md");
  const parsed = await parseSkill(services.files, join(services.root, file));
  if (!parsed.ok) {
    return `The skill ${file} cannot be read: ${problemText(parsed.problems)}`;
  }
  const own = parsed.value.frontMatter.metadata?.output;
  return [...(own === undefined ? [] : [own]), ...(skill.last ? [frame.action.output] : [])];
}

function skillWaiting(walk: Walk, frame: ActionFrame, at: { skill: SkillStep; record: StepRecord }): Progress {
  const { skill, record } = at;
  const round = numberField(record.detail, "round") ?? 1;
  const task: SkillTask = {
    place: skill.place,
    skill: skill.skill,
    tier: skill.tier,
    input: record.input,
    outputSchema: textsField(record.detail, "schemas")[0] ?? "",
    permissions: walk.services.policyOf(frame.mode.manifest.name),
    round,
    feedback: textsField(record.detail, "feedback"),
  };
  return waiting({ reason: "skill", stepKey: skillStepKey(skill.key, round), task });
}

async function startSkill(walk: Walk, frame: ActionFrame, skill: SkillStep): Promise<Progress> {
  const schemas = await skillSchemas(walk.services, frame, skill);
  if (typeof schemas === "string") {
    return refuse(walk, { key: skill.key, kind: "skill", input: skill.input }, schemas);
  }
  const detail = { mode: frame.mode.manifest.name, schemas: [...schemas], round: 1, feedback: [] };
  const record = await startRecord(walk, { key: skill.key, kind: "skill", input: skill.input, detail });
  return skillWaiting(walk, frame, { skill: skill, record: record });
}

function chargeEarlierRounds(walk: Walk, frame: ActionFrame, at: { skill: SkillStep; round: number }): void {
  const { skill, round } = at;
  for (let earlier = 1; earlier < round; earlier += 1) {
    for (const index of skill.checks.keys()) {
      replayed(frame.budget, walk.records.get(checkKey(skill.key, earlier, index)));
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
  const before = frame.budget.spent;
  const round = numberField(record.detail, "round") ?? 1;
  chargeEarlierRounds(walk, frame, { skill, round });
  const submitted = fieldOf(record.detail, "submitted");
  if (submitted === undefined) {
    return skillWaiting(walk, frame, { skill: skill, record: record });
  }
  return runChecks(walk, frame, { skill, record, round, submitted, before });
}

function verdictOf(check: string, progress: Settled): Verdict {
  if (progress.kind === "failed") {
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
  const feedback: string[] = [];
  for (const [index, check] of attempt.skill.checks.entries()) {
    const key = checkKey(attempt.skill.key, attempt.round, index);
    const leaf = { key, kind: "check" as const, script: check, input: attempt.submitted, place: attempt.skill.place };
    const progress = await runScript(walk, frame, leaf);
    if (progress.kind === "waiting") {
      return progress;
    }
    const verdict = verdictOf(check, progress);
    if (verdict.kind === "broken") {
      const spent = subtractSpend(frame.budget.spent, attempt.before);
      return endRecord(walk, { key: attempt.skill.key, settled: failed(verdict.reason), spent });
    }
    if (verdict.kind === "failed") {
      feedback.push(verdict.feedback);
    }
  }
  return concludeRound(walk, frame, { attempt, feedback });
}

async function concludeRound(
  walk: Walk,
  frame: ActionFrame,
  result: { readonly attempt: Attempt; readonly feedback: readonly string[] },
): Promise<Progress> {
  const { attempt, feedback } = result;
  const spent = subtractSpend(frame.budget.spent, attempt.before);
  if (feedback.length === 0) {
    return endRecord(walk, { key: attempt.skill.key, settled: done(attempt.submitted), spent });
  }
  if (attempt.round >= maximumRounds) {
    const reason =
      `The output of the skill ${attempt.skill.skill} failed its checks in round ${String(attempt.round)}, ` +
      `the last round: ${feedback.join(" ")}`;
    return endRecord(walk, { key: attempt.skill.key, settled: failed(reason), spent });
  }
  const detail = withFields(attempt.record.detail, { round: attempt.round + 1, feedback: [...feedback] }, [
    "submitted",
  ]);
  const record = await changeDetail(walk, attempt.skill.key, detail);
  return skillWaiting(walk, frame, { skill: attempt.skill, record: record });
}

export async function runNestedAction(walk: Walk, parent: BudgetFrame, nested: NestedAction): Promise<Progress> {
  const record = walk.records.get(nested.key);
  const replay = replayed(parent, record);
  if (replay !== undefined) {
    return replay;
  }
  const before = parent.spent;
  const input = record?.input ?? nested.input;
  if (record === undefined) {
    const detail = { mode: nested.target.mode.manifest.name, action: nested.target.name };
    await startRecord(walk, { key: nested.key, kind: nested.kind, input, detail }, nested.events ?? []);
  }
  const budget = childFrame(parent, nested.target.action.budget, walk.extra);
  const progress = await runActionFrame(walk, { ...nested.target, key: nested.key, budget }, input);
  return concludeComposite(walk, nested.key, { ...progress, spent: subtractSpend(parent.spent, before) });
}

async function runCall(walk: Walk, frame: ActionFrame, call: CallStep): Promise<Progress> {
  const replay = replayed(frame.budget, walk.records.get(call.key));
  if (replay !== undefined) {
    return replay;
  }
  const start = { key: call.key, kind: "call" as const, input: call.input };
  const target = resolveCall(walk.services.system, frame.mode, call.call);
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
  return runNestedAction(walk, frame.budget, { key: call.key, kind: "call", target, input: call.input });
}

type ActionStepAt = {
  readonly index: number;
  readonly step: Step;
  readonly input: Json;
};

function runActionStep(walk: Walk, frame: ActionFrame, at: ActionStepAt): Promise<Progress> {
  const run = frame.action.run;
  const step = stepOf(at.step);
  const key = stepKeyOf(frame, at.index);
  const place: StepPlace = {
    runId: walk.writer.runId,
    mode: frame.mode.manifest.name,
    action: frame.name,
    stepIndex: at.index,
  };
  switch (step.kind) {
    case "script":
      return runScript(walk, frame, { key, kind: "script", script: step.script, input: at.input, place });
    case "skill":
      return runSkill(walk, frame, { ...step, key, input: at.input, place, last: at.index === run.length - 1 });
    case "call":
      return runCall(walk, frame, { key, call: step.call, input: at.input });
  }
}

async function frameOutput(walk: Walk, frame: ActionFrame, output: Json): Promise<Progress> {
  const blocked = gate(walk, frame.budget, frame.key === "" ? "end" : `${frame.key}/end`);
  if (blocked !== undefined) {
    return blocked;
  }
  const check = { mode: frame.mode, schema: frame.action.output, value: output, label: "output" };
  const problems = await schemaProblems(walk.services, check);
  if (problems.length === 0) {
    return done(output);
  }
  return failed(`The output of ${frameLabel(frame)} does not match its schema: ${problemText(problems)}`);
}

export async function runActionFrame(walk: Walk, frame: ActionFrame, input: Json): Promise<Progress> {
  const check = { mode: frame.mode, schema: frame.action.input, value: input, label: "input" };
  const problems = await schemaProblems(walk.services, check);
  if (problems.length > 0) {
    return failed(`The input of ${frameLabel(frame)} does not match its schema: ${problemText(problems)}`);
  }
  let value = input;
  for (const [index, step] of frame.action.run.entries()) {
    const progress = await runActionStep(walk, frame, { index, step, input: value });
    if (progress.kind !== "done") {
      return progress;
    }
    value = progress.output;
  }
  return frameOutput(walk, frame, value);
}

export async function submissionProblems(
  services: Services,
  record: StepRecord,
  output: Json,
): Promise<readonly Problem[]> {
  const modeName = textField(record.detail, "mode") ?? "";
  const mode = services.system.modes.get(modeName);
  if (mode === undefined) {
    return [
      { file: "", path: "", message: `The skill step ${record.key} belongs to mode ${modeName}, which is gone.` },
    ];
  }
  const problems: Problem[] = [];
  for (const schema of textsField(record.detail, "schemas")) {
    problems.push(...(await schemaProblems(services, { mode, schema, value: output, label: "output" })));
  }
  return problems;
}
