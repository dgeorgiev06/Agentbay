import type { Action, Mode, Step } from "../generated/mode.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "../outcome.ts";
import { namingOf, type NamedTier } from "../roles.ts";
import { problemAt, type Loaded } from "../value-check.ts";

type WrittenSkillStep = Extract<Step, { readonly skill: string }>;

export type LoadedSkillStep = Pick<WrittenSkillStep, "skill" | "checks"> & NamedTier;

export type LoadedStep = Exclude<Step, WrittenSkillStep> | LoadedSkillStep;

export type LoadedAction = Omit<Action, "run"> & { readonly run: readonly LoadedStep[] };

export type LoadedMode = Omit<Mode, "actions"> & { readonly actions: Readonly<Record<string, LoadedAction>> };

type StepAt = {
  readonly action: string;
  readonly index: number;
  readonly step: Step;
};

type Steps = {
  readonly run: readonly LoadedStep[];
  readonly problems: readonly Problem[];
};

function loadedStep(loaded: Loaded<Mode>, at: StepAt): Outcome<LoadedStep> {
  const { step } = at;
  if (!("skill" in step)) {
    return succeededWith(step);
  }
  const naming = namingOf(step, step.skill);
  if (naming.ok) {
    const checks = step.checks === undefined ? {} : { checks: step.checks };
    return succeededWith({ skill: step.skill, ...checks, ...naming.named });
  }
  const path = ["actions", at.action, "run", at.index, ...(naming.field === "role" ? ["role"] : [])];
  const message = `Action ${at.action} of mode ${loaded.value.name} ${naming.said}`;
  return failedWith([problemAt(loaded, path, { message, fix: naming.fix })]);
}

function loadedSteps(loaded: Loaded<Mode>, [name, action]: readonly [string, Action]): Steps {
  const outcomes = action.run.map((step, index) => loadedStep(loaded, { action: name, index, step }));
  return {
    run: outcomes.flatMap((outcome) => (outcome.ok ? [outcome.value] : [])),
    problems: outcomes.flatMap((outcome) => (outcome.ok ? [] : outcome.problems)),
  };
}

export function loadedModeOf(loaded: Loaded<Mode>): Outcome<Loaded<LoadedMode>> {
  const entries = Object.entries(loaded.value.actions).map(([name, action]) => ({
    name,
    action,
    steps: loadedSteps(loaded, [name, action]),
  }));
  const problems = entries.flatMap((entry) => entry.steps.problems);
  if (problems.length > 0) {
    return failedWith(problems);
  }
  const actions = Object.fromEntries(entries.map((entry) => [entry.name, { ...entry.action, run: entry.steps.run }]));
  return succeededWith({ ...loaded, value: { ...loaded.value, actions } });
}
