import { computed, counted, joined, judged, shortened, type Card, type CardLine } from "./card-lines.ts";
import { heldByPlanRules } from "./cut-from-design.ts";
import { modulesReached, type DesignSummary } from "./design-summary.ts";
import type { Plan, PlannedSlice } from "./plan.ts";
import type { Conditions } from "./plan-conditions.ts";
import type { WorkedOut } from "./plan-waves.ts";
import {
  decidingWords,
  firstFoundWords,
  practiceLines,
  withheldAfterAnswer,
  type FirstFound,
  type PracticeAnswer,
} from "./practice-answers.ts";
import type { Problem } from "./problems.ts";

export type PlannerAnswer =
  { readonly kind: "not asked" } | (FirstFound & { readonly kind: "answered"; readonly changes: readonly string[] });

export type PlanCardInput = {
  readonly job: string;
  readonly into: string;
  readonly design: DesignSummary;
  readonly conditions: Conditions;
  readonly plan: Plan;
  readonly workedOut: WorkedOut;
  readonly practices: readonly PracticeAnswer[];
  readonly findings: readonly string[];
  readonly challenger: string;
  readonly answer: PlannerAnswer;
};

export type PlanCard = {
  readonly card: Card & { readonly withheld: { readonly approve?: string } };
  readonly offered: { readonly approve: boolean };
};

const titleShown = 60;

function errorsOf(input: PlanCardInput): readonly Problem[] {
  return input.workedOut.problems.filter((problem) => problem.level === "error");
}

function withheldReason(input: PlanCardInput): string | undefined {
  const errors = errorsOf(input).length;
  const reasons = [
    ...(errors === 0 ? [] : [`The plan check found ${counted(errors, "problem")}.`]),
    ...withheldAfterAnswer(input.practices, "a plan", input.answer.kind === "answered"),
  ];
  return reasons.length === 0 ? undefined : reasons.join(" ");
}

export function sliceWords(slice: PlannedSlice, design: DesignSummary): string {
  const modules = modulesReached(slice, design);
  const module = modules.length === 0 ? "no module of the design" : `module ${joined(modules)}`;
  const meets = slice.meets ?? [];
  const met = meets.length === 0 ? "meets no condition" : `meets ${meets.join(", ")}`;
  return `${slice.name}, ${module}: ${shortened(slice.title, titleShown)}; ${met}`;
}

function waveLines(input: PlanCardInput): readonly CardLine[] {
  const named = new Map(input.plan.slices.map((slice) => [slice.name, slice]));
  const waves = input.workedOut.waves.flatMap((wave) =>
    wave.slices.flatMap((name) => {
      const slice = named.get(name);
      return slice === undefined
        ? []
        : [computed("draw", `wave ${String(wave.wave)}: ${sliceWords(slice, input.design)}`)];
    }),
  );
  const { notPlaced } = input.workedOut;
  return [...waves, ...(notPlaced.length === 0 ? [] : [computed("draw", `in no wave: ${notPlaced.join(", ")}`)])];
}

function orderLines(plan: Plan): readonly CardLine[] {
  const afters = plan.slices.flatMap((slice) =>
    slice.after.map((after) => computed("draw", `${slice.name} after ${after.slice}: ${after.because}`)),
  );
  const because = plan.oneAfterAnotherBecause;
  return [...afters, ...(because === undefined ? [] : [computed("draw", `one after another because: ${because}`)])];
}

function coverageLine(input: PlanCardInput): CardLine {
  const unmet = input.workedOut.problems.flatMap((problem) =>
    problem.kind === "condition not met" ? [problem.condition] : [],
  );
  return computed(
    "draw",
    unmet.length === 0 ? "every condition met: yes" : `conditions no slice meets: ${unmet.join(", ")}`,
  );
}

function fixedLine(input: PlanCardInput): CardLine {
  const changed = input.workedOut.problems.flatMap((problem) =>
    problem.kind === "fixed file changed" ? [problem.file] : [],
  );
  if (changed.length > 0) {
    return computed("draw", `fixed files not made first: ${[...new Set(changed)].join(", ")}`);
  }
  const interfaceFiles = new Set(input.plan.slices.flatMap((slice) => slice.interface ?? [])).size;
  const tests = new Set(input.plan.slices.flatMap((slice) => slice.tests)).size;
  return computed(
    "draw",
    `fixed files made first: yes; ${counted(interfaceFiles, "interface file")} by the design, ` +
      `${counted(tests, "test file")} by their slices`,
  );
}

function problemLines(input: PlanCardInput): readonly CardLine[] {
  const { problems } = input.workedOut;
  const errors = errorsOf(input).length;
  const found =
    problems.length === 0
      ? "no problem"
      : `${counted(errors, "problem")}, ${counted(problems.length - errors, "warning")}`;
  return [
    computed("draw", `checked by script, as forge.waves checks a plan: ${found}`),
    ...problems.map((problem) =>
      computed("draw", `${problem.level === "error" ? "problem" : "warning"}: ${problem.sentence}`),
    ),
  ];
}

function findingLines(input: PlanCardInput): readonly CardLine[] {
  const heading = `findings left after the planner's answer: ${input.findings.length === 0 ? "none" : String(input.findings.length)}`;
  return [
    computed("draw", heading),
    ...input.findings.map((finding) => judged(input.challenger, `finding: ${finding}`)),
  ];
}

function answerLines(answer: PlannerAnswer): readonly CardLine[] {
  if (answer.kind === "not asked") {
    return [computed("draw", "the planner was not asked again, since the challenge found nothing")];
  }
  const changed = answer.changes.length === 0 ? "nothing" : joined(answer.changes);
  return [
    computed("draw", firstFoundWords(answer, "a plan")),
    computed("draw", `the planner changed ${changed}`),
    computed("draw", decidingWords),
  ];
}

export function planCard(input: PlanCardInput): PlanCard {
  const reason = withheldReason(input);
  const { plan, workedOut } = input;
  const offered = reason === undefined ? "approve is offered" : "approve is not offered";
  const lines = [
    computed(
      "draw",
      `${counted(plan.slices.length, "slice")} in ${counted(workedOut.waves.length, "wave")}; longest chain: ` +
        `${workedOut.longestChain.join(", ")}; ${offered}`,
    ),
    computed(
      "draw",
      `cut from ${input.design.file} and ${input.conditions.file}: ${counted(input.conditions.ids.length, "condition")}`,
    ),
    ...waveLines(input),
    ...orderLines(plan),
    coverageLine(input),
    fixedLine(input),
    ...problemLines(input),
    ...answerLines(input.answer),
    ...practiceLines({ answers: input.practices, heldByRules: heldByPlanRules, challenger: input.challenger }),
    ...findingLines(input),
    computed(
      "draw",
      `approve commits it into ${input.into} as docs/plans/NNNN-${input.job}.yaml, NNNN the next free number`,
    ),
  ];
  return {
    card: {
      title: `Commit the plan for ${input.job}?`,
      lines,
      withheld: reason === undefined ? {} : { approve: reason },
    },
    offered: { approve: reason === undefined },
  };
}
