import type { Dropped } from "./branch-endings.ts";
import {
  computedWhole,
  counted,
  facts,
  joined,
  sentenced,
  shortFacts,
  type CardLine,
  type Fact,
  type Screen,
} from "./card-lines.ts";
import { actionsBuiltBy, modulesReached, type DesignSummary } from "./design-summary.ts";
import { gateOf, type Gate } from "./gate.ts";
import { fastChecksLine, gateLine } from "./gate-words.ts";
import type { PlannedSlice } from "./plan.ts";
import { lastRound } from "./rounds.ts";
import type { GateShown } from "./start-card.ts";

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
  readonly gate: GateShown;
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

const designName = /^[a-z][a-z0-9-]*$/;

const plainFile = /^[A-Za-z0-9_.-]+$/;

function callsOf(skill: SkillSteps): number {
  return skill.steps * (skill.checked ? answersOfACheckedStep : 1);
}

export function modelCallsOfASlice(): number {
  return skillStepsOfASlice.reduce((sum, skill) => sum + callsOf(skill), 0);
}

function said(words: string): CardLine {
  return computedWhole("wave", sentenced(words));
}

function modeOf(slices: readonly PlannedSlice[]): Extract<Gate, { readonly gate: "mode" }> | undefined {
  const gate = gateOf(slices);
  return gate.gate === "mode" ? gate : undefined;
}

function sliceNames(slices: readonly PlannedSlice[]): string {
  return joined(slices.map((slice) => slice.name));
}

function conditionsMet(slices: readonly PlannedSlice[]): readonly string[] {
  return [...new Set(slices.flatMap((slice) => slice.meets ?? []))];
}

function branchesWord(count: number): string {
  return count === 1 ? "1 branch is" : `${String(count)} branches are`;
}

function titleOf(start: WaveStart): string {
  const mode = modeOf(start.slices);
  const file = start.plan.split("/").at(-1) ?? "";
  const plan = plainFile.test(file) ? `plan ${file}` : "the plan";
  if (mode !== undefined && start.waves === 1) {
    return `Build the ${mode.mode} mode?`;
  }
  const wave = `wave ${String(start.wave)} of ${String(start.waves)}`;
  return mode === undefined ? `Build ${wave} of ${plan}?` : `Build ${wave} of the ${mode.mode} mode?`;
}

function problemFacts(leftovers: readonly Dropped[]): readonly Fact[] {
  if (leftovers.length === 0) {
    return [];
  }
  const words =
    `${branchesWord(leftovers.length)} left from an earlier build of this wave. Building over drops them; ` +
    "each branch and its full commit are in the details, so their work can be found again.";
  return facts("problems", [said(words)]);
}

function builtWords(slices: readonly PlannedSlice[]): string {
  const mode = modeOf(slices);
  if (mode === undefined) {
    return `${counted(slices.length, "slice")}: ${sliceNames(slices)}`;
  }
  const verb = slices.length === 1 ? "builds" : "build";
  return `${sliceNames(slices)} ${verb} the mode ${mode.mode}`;
}

function meetsWords(slices: readonly PlannedSlice[]): string {
  const met = conditionsMet(slices).length;
  const subject = slices.length === 1 ? "It meets" : "They meet";
  return met === 0 ? `${subject} none of your conditions` : `${subject} ${String(met)} of your conditions`;
}

function shortWhat(start: WaveStart): readonly Fact[] {
  const calls = modelCallsOfASlice() * start.slices.length;
  return shortFacts("what", [
    said(builtWords(start.slices)),
    said(meetsWords(start.slices)),
    said(`At most ${String(calls)} model calls`),
  ]);
}

function planFacts(start: WaveStart): readonly Fact[] {
  const named = start.slices.length === 1 ? "slice" : "slices";
  return facts(
    "what",
    [
      said(`The plan you approved describes it: ${start.plan}, ${named} ${sliceNames(start.slices)}`),
      said(`This is wave ${String(start.wave)} of ${String(start.waves)} of that plan`),
      said(`The plan was read at commit ${start.base}, the head of ${start.into}; each slice is cut from that commit`),
    ],
    "the plan",
  );
}

function whereWords(slice: PlannedSlice): string {
  const mode = modeOf([slice]);
  if (mode !== undefined) {
    return `${slice.name} builds the mode ${mode.mode}; it writes only inside ${mode.folder}`;
  }
  const scope = slice.scope.length === 0 ? "it names no write scope" : `it writes in ${joined([...slice.scope])}`;
  return `${slice.name} is a slice of kind ${slice.kind}; ${scope}`;
}

function actionName(action: string): string | undefined {
  const [named, name, ...rest] = action.split(".");
  return named !== undefined &&
    designName.test(named) &&
    name !== undefined &&
    designName.test(name) &&
    rest.length === 0
    ? name
    : undefined;
}

function designWords(slice: PlannedSlice, design: DesignSummary | undefined): readonly string[] {
  if (design === undefined) {
    return [];
  }
  const named = actionsBuiltBy(slice.interface ?? [], design).map((action) => actionName(action.action));
  const actions = named.filter((name) => name !== undefined);
  const modules = modulesReached(slice, design).filter((name) => designName.test(name));
  const from = `from the design ${design.file}`;
  return [
    ...(actions.length === 0 ? [] : [`Its actions, ${from}: ${joined(actions)}`]),
    ...(modules.length === 0 ? [] : [`In the design, it reaches the module ${joined(modules)}`]),
  ];
}

const idsAFact = 20;

function inGroups(ids: readonly string[]): readonly string[] {
  const groups: string[] = [];
  for (let at = 0; at < ids.length; at += idsAFact) {
    groups.push(ids.slice(at, at + idsAFact).join(", "));
  }
  return groups;
}

function conditionWords(slice: PlannedSlice): readonly string[] {
  const meets = slice.meets ?? [];
  if (meets.length === 0) {
    return ["It meets none of your conditions"];
  }
  return [`It meets ${String(meets.length)} of your conditions, by id`, ...inGroups(meets)];
}

function interfaceWords(slice: PlannedSlice): readonly string[] {
  const files = slice.interface ?? [];
  if (files.length === 0) {
    return ["It names no interface file, so the test writer and the builder get no agreed shape"];
  }
  return [`It names ${counted(files.length, "interface file")}`, ...files.map((file) => `The file ${file}`)];
}

function sliceFacts(slice: PlannedSlice, design: DesignSummary | undefined): readonly Fact[] {
  const words = [whereWords(slice), ...designWords(slice, design), ...conditionWords(slice), ...interfaceWords(slice)];
  return facts("what", words.map(said), `slice ${slice.name}`);
}

function sideBySideFacts(start: WaveStart): readonly Fact[] {
  const names = start.slices.map((slice) => slice.name);
  const most = `At most ${counted(start.sideBySide, "builder")} at once, by the setting sideBySide`;
  const later = names.slice(start.sideBySide);
  const starts = later.length === 1 ? "which starts" : "each starting";
  const order =
    later.length === 0
      ? []
      : [`First ${joined(names.slice(0, start.sideBySide))}; then ${joined(later)}, ${starts} as soon as a slice ends`];
  return facts("what", [most, ...order].map(said), "side by side");
}

function callFacts(start: WaveStart): readonly Fact[] {
  const each = modelCallsOfASlice();
  const parts = skillStepsOfASlice.map((skill) => `${skill.skill} ${String(callsOf(skill))}`);
  return facts(
    "what",
    [
      said(`At most ${String(each)} model calls a slice, ${String(each * start.slices.length)} for the wave`),
      said(`A slice's calls: ${parts.join(", ")}`),
      said(`A step whose answer a check may send back counts ${String(answersOfACheckedStep)} calls`),
    ],
    "model calls",
  );
}

function leftoverFacts(leftovers: readonly Dropped[]): readonly Fact[] {
  if (leftovers.length === 0) {
    return [];
  }
  const each = leftovers.map((left) => said(`The branch ${left.branch}, at commit ${left.commit}`));
  return facts(
    "what",
    [...each, said("Building over drops them; with these commits their work can be found again")],
    "branches an earlier run left",
  );
}

function atTheEnd(gate: Gate): string {
  if (gate.gate === "whole") {
    return "At the end: the checks and every test of the project, on the slices combined";
  }
  return `At the end: the ${gate.mode} mode's tests, the fast checks and bay check; not the other tests`;
}

function checkFacts(start: WaveStart): readonly Fact[] {
  const { gate, alsoRun } = start.gate;
  const names = start.slices.map((slice) => slice.name);
  const gateWords = [gateLine(gate, names, "before"), ...fastChecksLine(gate, alsoRun)];
  const once = "Each slice's own proof leaves out the checks; they run once, on the slices combined";
  return [
    ...shortFacts("checks", [said(atTheEnd(gate))]),
    ...facts("checks", [...gateWords, once].map(said), "the gate"),
  ];
}

export function waveStartCard(start: WaveStart): Screen {
  return {
    title: titleOf(start),
    lines: [
      ...problemFacts(start.leftovers),
      ...shortWhat(start),
      ...planFacts(start),
      ...start.slices.flatMap((slice) => sliceFacts(slice, start.design)),
      ...sideBySideFacts(start),
      ...callFacts(start),
      ...leftoverFacts(start.leftovers),
      ...checkFacts(start),
    ],
  };
}
