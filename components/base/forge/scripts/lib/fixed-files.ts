import type { Plan, PlannedSlice } from "./plan.ts";

export type FixedFileProblem = {
  readonly kind: "fixed file changed";
  readonly level: "error";
  readonly slice: string;
  readonly owner: string;
  readonly file: string;
  readonly sentence: string;
};

export type ComesAfter = (one: string, other: string) => boolean;

type Fixed = {
  readonly owner: PlannedSlice;
  readonly file: string;
  readonly what: "a test it names" | "an interface file it builds against";
};

function fixedOf(slice: PlannedSlice): readonly Fixed[] {
  const tests = slice.tests.map((file): Fixed => ({ owner: slice, file, what: "a test it names" }));
  const named = (slice.interface ?? []).map((file): Fixed => ({
    owner: slice,
    file,
    what: "an interface file it builds against",
  }));
  return [...tests, ...named];
}

function changedBy(slice: PlannedSlice): readonly string[] {
  return [...slice.scope, ...slice.tests];
}

function sentenceFor(slice: PlannedSlice, fixed: Fixed, comesAfter: ComesAfter): string {
  const { file } = fixed;
  const owner = fixed.owner.name;
  const changes = `${slice.name} changes ${file}, ${fixed.what} of ${owner}`;
  if (comesAfter(owner, slice.name)) {
    return `${changes}, before ${owner} comes. Take ${file} out of ${slice.name}, or change it in a slice after ${owner}.`;
  }
  return (
    `${changes}, and nothing orders the two. Put ${owner} in the after of ${slice.name}, so that the file is ` +
    `made first, or take ${file} out of ${slice.name}.`
  );
}

function changedFirst(slice: PlannedSlice, fixed: Fixed, comesAfter: ComesAfter): FixedFileProblem {
  const sentence = sentenceFor(slice, fixed, comesAfter);
  return {
    kind: "fixed file changed",
    level: "error",
    slice: slice.name,
    owner: fixed.owner.name,
    file: fixed.file,
    sentence,
  };
}

function isAllowed(slice: PlannedSlice, fixed: Fixed, comesAfter: ComesAfter): boolean {
  const ownTest = slice.tests.includes(fixed.file);
  return comesAfter(slice.name, fixed.owner.name) || (ownTest && comesAfter(fixed.owner.name, slice.name));
}

export function fixedFileProblems(plan: Plan, comesAfter: ComesAfter): readonly FixedFileProblem[] {
  const fixed = plan.slices.flatMap(fixedOf);
  return plan.slices.flatMap((slice) =>
    fixed
      .filter((each) => each.owner.name !== slice.name && changedBy(slice).includes(each.file))
      .filter((each) => !isAllowed(slice, each, comesAfter))
      .map((each) => changedFirst(slice, each, comesAfter)),
  );
}
