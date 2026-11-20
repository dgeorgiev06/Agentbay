import type { Dropped } from "./branch-endings.ts";
import { computed, counted, joined, shortened, type Card } from "./card-lines.ts";
import { modulesReached, type DesignSummary } from "./design-summary.ts";
import { leftoverWords } from "./start-card.ts";
import type { PlannedSlice } from "./plan.ts";
import { lastRound } from "./rounds.ts";

export type WaveStart = {
  readonly plan: string;
  readonly wave: number;
  readonly waves: number;
  readonly base: string;
  readonly into: string;
  readonly slices: readonly PlannedSlice[];
  readonly design?: DesignSummary;
  readonly sideBySide: number;
  readonly leftovers: readonly Dropped[];
};

type SkillSteps = {
  readonly skill: string;
  readonly steps: number;
  readonly checked: boolean;
};

const answersOfACheckedStep = 3;

const skillStepsOfASlice: readonly SkillSteps[] = [
  { skill: "declare", steps: 1, checked: true },
  { skill: "write-tests", steps: lastRound, checked: true },
  { skill: "build-without-tests", steps: lastRound, checked: false },
  { skill: "review", steps: lastRound, checked: true },
  { skill: "plant", steps: 1, checked: true },
];

const titleShown = 60;

export function modelCallsOfASlice(): number {
  return skillStepsOfASlice.reduce((sum, skill) => sum + skill.steps * (skill.checked ? answersOfACheckedStep : 1), 0);
}

function whereWords(slice: PlannedSlice, design: DesignSummary | undefined): string {
  const modules = design === undefined ? [] : modulesReached(slice, design);
  return modules.length === 0 ? `scope ${joined([...slice.scope])}` : `module ${joined(modules)}`;
}

function sliceWords(slice: PlannedSlice, design: DesignSummary | undefined): readonly string[] {
  const meets = slice.meets ?? [];
  const met = meets.length === 0 ? "meets no condition" : `meets ${meets.join(", ")}`;
  const files = counted((slice.interface ?? []).length, "interface file");
  return [
    `${slice.name}: ${shortened(slice.title, titleShown)}`,
    `${slice.name}, ${whereWords(slice, design)}; ${met}; ${files}`,
  ];
}

function sideBySideWords(start: WaveStart): readonly string[] {
  const names = start.slices.map((slice) => slice.name);
  const said = `side by side: at most ${String(start.sideBySide)} builders, the setting sideBySide`;
  const later = names.slice(start.sideBySide);
  if (later.length === 0) {
    return [said];
  }
  const starts = later.length === 1 ? "which starts" : "each starting";
  const first = joined(names.slice(0, start.sideBySide));
  return [said, `first ${first}; then ${joined(later)}, ${starts} as soon as a slice ends`];
}

function costWords(start: WaveStart): string {
  const each = modelCallsOfASlice();
  return `cost: at most ${String(each)} model calls a slice, ${String(each * start.slices.length)} for the wave`;
}

export function waveStartCard(start: WaveStart): Card {
  const file = start.plan.split("/").at(-1) ?? start.plan;
  const words = [
    `${counted(start.slices.length, "slice")} of wave ${String(start.wave)} of ${String(start.waves)} in ${start.plan}`,
    `base ${start.base}, the head of ${start.into}`,
    ...start.slices.flatMap((slice) => sliceWords(slice, start.design)),
    ...sideBySideWords(start),
    costWords(start),
    "each slice's own proof leaves out the checks; they and the whole test run go once, on the slices combined",
    ...leftoverWords(start.leftovers),
  ];
  return { title: `Build wave ${String(start.wave)} of ${file}?`, lines: words.map((said) => computed("wave", said)) };
}
