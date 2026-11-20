import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { computed, type Card, type CardLine } from "./card-lines.ts";
import { listOf, textOf } from "./json-values.ts";

export type SliceWork = {
  readonly builder: string;
  readonly head: string;
};

export type WaveSlice = SliceWork & {
  readonly merged: boolean;
};

export type Ending =
  | { readonly kind: "rounds ended"; readonly name: string; readonly round: number; readonly work: SliceWork }
  | { readonly kind: "merged"; readonly name: string; readonly work: SliceWork }
  | { readonly kind: "kept"; readonly work: SliceWork }
  | { readonly kind: "committed"; readonly name: string; readonly landed: boolean }
  | { readonly kind: "wave merged"; readonly wave: string; readonly slices: readonly WaveSlice[] }
  | {
      readonly kind: "wave kept";
      readonly wave: string;
      readonly combined: boolean;
      readonly slices: readonly SliceWork[];
    };

export type Dropped = {
  readonly branch: string;
  readonly commit: string;
};

export type Stayed = {
  readonly branch: string;
  readonly reason: string;
};

export type Branches = {
  readonly keep: readonly string[];
  readonly drop: readonly string[];
};

export type BranchesSaid = {
  readonly dropped?: readonly Dropped[];
  readonly stayed?: readonly Stayed[];
};

export function branchesSaid(dropped: readonly Dropped[], stayed: readonly Stayed[]): BranchesSaid {
  const droppedPart = dropped.length === 0 ? {} : { dropped: dropped.map((each) => ({ ...each })) };
  return stayed.length === 0 ? droppedPart : { ...droppedPart, stayed: stayed.map((each) => ({ ...each })) };
}

export function stayedOf(value: Json | undefined): readonly Stayed[] {
  return listOf(value).map((entry) => {
    const fields = fieldsOf(entry);
    return { branch: textOf(fields.branch), reason: textOf(fields.reason) };
  });
}

export function droppedOf(value: Json | undefined): readonly Dropped[] {
  return listOf(value).map((entry) => {
    const fields = fieldsOf(entry);
    return { branch: textOf(fields.branch), commit: textOf(fields.commit) };
  });
}

export function stayedLines(stayed: readonly Stayed[]): readonly CardLine[] {
  return stayed.map((each) => computed("draw", `${each.branch} stayed: ${each.reason}`));
}

export function withStayedLines<Drawn extends { readonly card: Card }>(drawn: Drawn, stayed: readonly Stayed[]): Drawn {
  if (stayed.length === 0) {
    return drawn;
  }
  return { ...drawn, card: { ...drawn.card, lines: [...drawn.card.lines, ...stayedLines(stayed)] } };
}

export function branchOf(name: string): string {
  return `forge/${name}`;
}

function counting(from: number, to: number): readonly number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, at) => from + at);
}

export function roundsBranches(name: string, round: number): readonly string[] {
  const builders = counting(2, round).map((number) => branchOf(`${name}-${String(number)}`));
  const tests = counting(1, round).map((number) => branchOf(`${name}-tests-${String(number)}`));
  return [branchOf(name), ...builders, ...tests];
}

function workOf(work: SliceWork): readonly string[] {
  return [work.builder, work.head];
}

function apart(all: readonly string[], keep: readonly string[]): Branches {
  return { keep, drop: all.filter((branch) => !keep.includes(branch)) };
}

function afterWave(ending: Extract<Ending, { readonly kind: "wave merged" }>): Branches {
  const merged = ending.slices.filter((slice) => slice.merged).flatMap(workOf);
  const waveOwn = [branchOf(`${ending.wave}-merge`), branchOf(ending.wave)];
  return { keep: ending.slices.filter((slice) => !slice.merged).flatMap(workOf), drop: [...waveOwn, ...merged] };
}

function afterWaveKept(ending: Extract<Ending, { readonly kind: "wave kept" }>): Branches {
  const combined = branchOf(ending.wave);
  const work = ending.slices.flatMap(workOf);
  return ending.combined ? { keep: [...work, combined], drop: [] } : { keep: work, drop: [combined] };
}

export function branchesAfter(ending: Ending): Branches {
  switch (ending.kind) {
    case "rounds ended":
      return apart(roundsBranches(ending.name, ending.round), workOf(ending.work));
    case "merged":
      return { keep: [], drop: [branchOf(`${ending.name}-merge`), ...workOf(ending.work)] };
    case "kept":
      return { keep: workOf(ending.work), drop: [] };
    case "committed":
      return ending.landed ? { keep: [], drop: [branchOf(ending.name)] } : { keep: [branchOf(ending.name)], drop: [] };
    case "wave merged":
      return afterWave(ending);
    case "wave kept":
      return afterWaveKept(ending);
  }
}
