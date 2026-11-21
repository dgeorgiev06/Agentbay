import type { Json } from "../../../../../bay/sdk.ts";
import { counted, joined } from "./card-lines.ts";
import type { DesignSummary } from "./design-summary.ts";
import type { Plan, PlannedSlice } from "./plan.ts";
import type { Wave, WorkedOut } from "./plan-waves.ts";
import { sliceRequests } from "./slice-requests.ts";

export type WaveAsked = {
  readonly plan: string;
  readonly wave: number;
  readonly into: string;
};

export type PlanFound = {
  readonly plan: Plan;
  readonly document: Json;
  readonly workedOut: WorkedOut;
  readonly design?: DesignSummary;
};

export type AtInto = {
  readonly base: string;
  readonly present: readonly string[];
  readonly name: string;
};

export type WaveFound =
  | {
      readonly kind: "wave";
      readonly waves: number;
      readonly slices: readonly PlannedSlice[];
      readonly requests: readonly Json[];
    }
  | { readonly kind: "refused"; readonly sentences: readonly string[] };

function errorSentences(asked: WaveAsked, found: PlanFound): readonly string[] {
  const errors = found.workedOut.problems.filter((problem) => problem.level === "error");
  if (errors.length === 0) {
    return [];
  }
  const sentences = errors.map((problem) => problem.sentence).join(" ");
  return [
    `forge.waves finds ${counted(errors.length, "error")} in the plan ${asked.plan}, so no wave of it is built: ` +
      sentences,
  ];
}

function waveAsked(asked: Pick<WaveAsked, "wave">, waves: readonly Wave[]): Wave | undefined {
  return waves.find((wave) => wave.wave === asked.wave);
}

function noWaveSentence(asked: WaveAsked, waves: readonly Wave[]): string {
  return (
    `The plan ${asked.plan} has ${counted(waves.length, "wave")}, so it has no wave ${String(asked.wave)}; ` +
    `ask for a wave from 1 to ${String(waves.length)}.`
  );
}

function slicesNamed(plan: Plan, names: readonly string[]): readonly PlannedSlice[] {
  return names.flatMap((name) => plan.slices.filter((slice) => slice.name === name));
}

function withoutInterface(slices: readonly PlannedSlice[]): readonly string[] {
  return slices
    .filter((slice) => (slice.interface ?? []).length === 0)
    .map(
      (slice) =>
        `The slice ${slice.name} names no interface files, and a wave builds a slice only against an agreed ` +
        "interface; name its interface files in the plan, or build it alone with the workflow rounds.",
    );
}

function earlierOf(plan: Plan, slices: readonly PlannedSlice[]): readonly PlannedSlice[] {
  const names = new Set(slices.flatMap((slice) => slice.after.map((after) => after.slice)));
  return plan.slices.filter((slice) => names.has(slice.name));
}

export function testsToLookFor(found: PlanFound, wave: number): readonly string[] {
  const asked = waveAsked({ wave }, found.workedOut.waves);
  const slices = slicesNamed(found.plan, asked?.slices ?? []);
  return [...new Set(earlierOf(found.plan, slices).flatMap((slice) => slice.tests))];
}

type Looked = {
  readonly into: string;
  readonly present: readonly string[];
};

function unmergedSentence(slice: PlannedSlice, earlier: PlannedSlice, at: Looked): string | undefined {
  if (earlier.tests.length === 0) {
    return (
      `The slice ${slice.name} comes after ${earlier.name}, and forge cannot tell whether ${earlier.name} is merged ` +
      `into ${at.into}: ${earlier.name} names no test file to look for. Build the wave once ${earlier.name} ` +
      "names its tests in the plan."
    );
  }
  const missing = earlier.tests.filter((path) => !at.present.includes(path));
  if (missing.length === 0) {
    return undefined;
  }
  return (
    `The slice ${slice.name} comes after ${earlier.name}, which is not merged into ${at.into}: its test ` +
    `${joined(missing)} is not there. Merge ${earlier.name}'s wave first.`
  );
}

function notMerged(found: PlanFound, slices: readonly PlannedSlice[], at: Looked): readonly string[] {
  const earlier = new Map(earlierOf(found.plan, slices).map((slice) => [slice.name, slice]));
  return slices.flatMap((slice) =>
    slice.after.flatMap((after) => {
      const before = earlier.get(after.slice);
      return before === undefined ? [] : (unmergedSentence(slice, before, at) ?? []);
    }),
  );
}

function clashes(one: string, other: string): boolean {
  return one !== other && other.startsWith(`${one}-`);
}

export function nameClashes(names: readonly string[]): readonly (readonly [string, string])[] {
  return names.flatMap((one) => names.filter((other) => clashes(one, other)).map((other) => [one, other] as const));
}

function clashSentences(slices: readonly PlannedSlice[], wave: string): readonly string[] {
  return nameClashes([...slices.map((slice) => slice.name), wave]).map(
    ([one, other]) =>
      `The names ${one} and ${other} clash in a wave: forge names worktrees after ${one} with a dash and more, ` +
      `such as ${one}-2 for its second round, and one of them could be ${other}'s. Rename the slice in the plan.`,
  );
}

export function waveOf(asked: WaveAsked, found: PlanFound, at: AtInto): WaveFound {
  const errors = errorSentences(asked, found);
  if (errors.length > 0) {
    return { kind: "refused", sentences: errors };
  }
  const { waves } = found.workedOut;
  const wave = waveAsked(asked, waves);
  if (wave === undefined) {
    return { kind: "refused", sentences: [noWaveSentence(asked, waves)] };
  }
  const slices = slicesNamed(found.plan, wave.slices);
  const sentences = [
    ...withoutInterface(slices),
    ...notMerged(found, slices, { ...at, into: asked.into }),
    ...clashSentences(slices, at.name),
  ];
  if (sentences.length > 0) {
    return { kind: "refused", sentences };
  }
  const requests = sliceRequests(found.document, wave.slices, { base: at.base, design: found.design });
  return { kind: "wave", waves: waves.length, slices, requests };
}
