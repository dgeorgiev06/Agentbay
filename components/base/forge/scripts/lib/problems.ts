import type { SharedPath } from "./scopes.ts";

export type Problem =
  | {
      readonly kind: "after names no slice";
      readonly level: "error";
      readonly slice: string;
      readonly after: string;
      readonly sentence: string;
    }
  | { readonly kind: "cycle"; readonly level: "error"; readonly slices: readonly string[]; readonly sentence: string }
  | {
      readonly kind: "scopes share a path";
      readonly level: "error";
      readonly slices: readonly [string, string];
      readonly patterns: readonly [string, string];
      readonly example: string;
      readonly sentence: string;
    }
  | {
      readonly kind: "scopes may share a path";
      readonly level: "error";
      readonly slices: readonly [string, string];
      readonly patterns: readonly [string, string];
      readonly sentence: string;
    }
  | {
      readonly kind: "whole feature";
      readonly level: "warning";
      readonly slice: string;
      readonly feature: string;
      readonly sentence: string;
    }
  | { readonly kind: "one after another"; readonly level: "error"; readonly sentence: string };

const narrowOrOrder = "Narrow a scope, or order the two with an after.";

export function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
}

export function afterNamesNoSlice(slice: string, after: string): Problem {
  const sentence = `${slice} comes after ${after}, but the plan has no slice named ${after}. Correct the name, or add the slice.`;
  return { kind: "after names no slice", level: "error", slice, after, sentence };
}

export function cycle(slices: readonly string[]): Problem {
  const sentence =
    slices.length === 1
      ? `${listed(slices)} comes after itself, so it cannot start. Remove that after.`
      : `${listed(slices)} wait for each other, so none of them can start. Remove an after among them.`;
  return { kind: "cycle", level: "error", slices, sentence };
}

export function sharedScopes(slices: readonly [string, string], shared: SharedPath): Problem | undefined {
  const [one, other] = slices;
  switch (shared.kind) {
    case "share no path":
      return undefined;
    case "share a path": {
      const [first, second] = shared.patterns;
      const sentence =
        `${one} and ${other} could run in one wave, but both scopes admit ${shared.example}: ` +
        `${first} in ${one} and ${second} in ${other}. ${narrowOrOrder}`;
      const { patterns, example } = shared;
      return { kind: "scopes share a path", level: "error", slices, patterns, example, sentence };
    }
    case "may share a path": {
      const [first, second] = shared.patterns;
      const sentence =
        `${one} and ${other} could run in one wave, and forge cannot tell whether ${first} in ${one} and ` +
        `${second} in ${other} admit a path in common: ${shared.reason} ${narrowOrOrder}`;
      return { kind: "scopes may share a path", level: "error", slices, patterns: shared.patterns, sentence };
    }
  }
}

export function wholeFeature(slice: string, feature: string): Problem {
  const sentence =
    `${slice}'s scope admits every private file of the kernel feature ${feature}. ` +
    "The feature may need an entry first, so that a slice can be given a narrower scope.";
  return { kind: "whole feature", level: "warning", slice, feature, sentence };
}

export function oneAfterAnother(): Problem {
  const sentence =
    "Every slice waits for the one before, so no two can run side by side. " +
    "Say why no other order exists in oneAfterAnotherBecause, or remove an after that is not needed.";
  return { kind: "one after another", level: "error", sentence };
}
