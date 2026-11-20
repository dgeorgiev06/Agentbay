import type { Json, RunEvent, Tier } from "../contracts.ts";
import { foreachItemKey, workflowStepKey } from "./step-key.ts";
import { isGivenStep } from "./workflow-part.ts";

export type StepSource = { readonly step: string; readonly item?: number };

export type SkillUsed = {
  readonly mode: string;
  readonly skill: string;
  readonly tier: Tier;
};

type SkillSeen = SkillUsed & {
  readonly calledRuns?: readonly string[];
};

export type StepSeen = {
  readonly kind: string;
  readonly status: string;
  readonly skill: SkillSeen | undefined;
  readonly attempts?: readonly number[];
  readonly items?: readonly Json[];
};

export type Records = {
  readonly keys: ReadonlyMap<string, string>;
  readonly foreachOf: ReadonlyMap<string, string>;
  readonly steps: ReadonlyMap<string, StepSeen>;
  readonly events: readonly RunEvent[];
};

export type Cited = {
  readonly id: string;
  readonly named: string;
  readonly key: string;
  readonly foreach?: string;
  readonly skills: readonly SkillUsed[];
  readonly calledRuns: readonly string[];
  readonly given: boolean;
};

export function isUnder(key: string, other: string): boolean {
  return other.startsWith(`${key}/`);
}

type Placed = {
  readonly named: string;
  readonly key: string | undefined;
  readonly foreach?: string;
  readonly given: boolean;
};

function plainPlace(context: Records, id: string): Placed | string {
  const foreach = context.foreachOf.get(id);
  if (foreach !== undefined && !context.keys.has(id)) {
    return `cites step ${id}, which runs in each item of step ${foreach}; a line names its item as source.item.`;
  }
  const key = context.keys.get(id);
  return { named: `step ${id}`, key, given: key !== undefined && isGivenStep(context.events, key) };
}

function itemPlace(context: Records, id: string, item: number): Placed | string {
  const foreach = context.foreachOf.get(id);
  if (foreach === undefined) {
    return `cites item ${String(item)} of step ${id}, which is not a step inside a foreach.`;
  }
  const named = `step ${id} in item ${String(item)} of ${foreach}`;
  const foreachKey = context.keys.get(foreach);
  if (foreachKey === undefined) {
    return { named, key: undefined, foreach, given: false };
  }
  const attempt = context.steps.get(foreachKey)?.attempts?.[item] ?? 1;
  const key = workflowStepKey(foreachItemKey(foreachKey, item, attempt), id);
  return { named, key, foreach, given: isGivenStep(context.events, foreachKey) };
}

function placeOf(context: Records, source: StepSource): Placed | string {
  return source.item === undefined ? plainPlace(context, source.step) : itemPlace(context, source.step, source.item);
}

function notFinished(named: string): string {
  return `cites ${named}, which has not finished in this run before the approval.`;
}

function recordProblem(named: string, record: StepSeen | undefined): string | undefined {
  if (record === undefined || record.status !== "done") {
    return notFinished(named);
  }
  return record.kind === "action"
    ? undefined
    : `cites ${named}, which is a ${record.kind} step; a line cites an action step.`;
}

export function citedStep(context: Records, source: StepSource): Cited | string {
  const placed = placeOf(context, source);
  if (typeof placed === "string") {
    return placed;
  }
  const { named, key, given } = placed;
  if (key === undefined) {
    return notFinished(named);
  }
  const record = context.steps.get(key);
  const cited = { id: source.step, named, key, ...(placed.foreach === undefined ? {} : { foreach: placed.foreach }) };
  if (record === undefined && given) {
    return { ...cited, skills: [], calledRuns: [], given };
  }
  return recordProblem(named, record) ?? { ...cited, ...skillsUnder(context.steps, key), given };
}

function skillsUnder(steps: Records["steps"], key: string): Pick<Cited, "skills" | "calledRuns"> {
  const skills: SkillUsed[] = [];
  const calledRuns: string[] = [];
  for (const [under, step] of steps) {
    if (step.skill !== undefined && isUnder(key, under)) {
      const { mode, skill, tier } = step.skill;
      skills.push({ mode, skill, tier });
      calledRuns.push(...(step.skill.calledRuns ?? []));
    }
  }
  return { skills, calledRuns };
}
