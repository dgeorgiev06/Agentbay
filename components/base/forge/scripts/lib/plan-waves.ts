import { pathMatch } from "../../../../../bay/sdk.ts";
import type { Feature, Plan, PlannedSlice } from "./plan.ts";
import { afterNamesNoSlice, cycle, oneAfterAnother, sharedScopes, wholeFeature, type Problem } from "./problems.ts";
import { scopesShare, type SharedPath } from "./scopes.ts";

export type Wave = {
  readonly wave: number;
  readonly slices: readonly string[];
  readonly builders: number;
};

export type WorkedOut = {
  readonly waves: readonly Wave[];
  readonly notPlaced: readonly string[];
  readonly longestChain: readonly string[];
  readonly problems: readonly Problem[];
};

type Order = {
  readonly slices: readonly PlannedSlice[];
  readonly waitsFor: ReadonlyMap<string, readonly string[]>;
  readonly behind: ReadonlyMap<string, ReadonlySet<string>>;
};

type UnorderedPair = {
  readonly slices: readonly [PlannedSlice, PlannedSlice];
  readonly shared: SharedPath;
};

function waitsForOf(plan: Plan): ReadonlyMap<string, readonly string[]> {
  const index = new Map(plan.slices.map((slice, at) => [slice.name, at]));
  const known = (slice: PlannedSlice): readonly string[] =>
    slice.after
      .map((after) => after.slice)
      .filter((name) => index.has(name))
      .sort((one, other) => (index.get(one) ?? 0) - (index.get(other) ?? 0));
  return new Map(plan.slices.map((slice) => [slice.name, known(slice)]));
}

function behindOf(waitsFor: ReadonlyMap<string, readonly string[]>, name: string): ReadonlySet<string> {
  const behind = new Set<string>();
  const waiting = [...(waitsFor.get(name) ?? [])];
  for (let next = waiting.pop(); next !== undefined; next = waiting.pop()) {
    if (!behind.has(next)) {
      behind.add(next);
      waiting.push(...(waitsFor.get(next) ?? []));
    }
  }
  return behind;
}

function orderOf(plan: Plan): Order {
  const waitsFor = waitsForOf(plan);
  const behind = new Map(plan.slices.map((slice) => [slice.name, behindOf(waitsFor, slice.name)]));
  return { slices: plan.slices, waitsFor, behind };
}

function isOrdered(order: Order, one: string, other: string): boolean {
  return order.behind.get(one)?.has(other) === true || order.behind.get(other)?.has(one) === true;
}

function placeableInOrder(order: Order): readonly PlannedSlice[] {
  const placed: PlannedSlice[] = [];
  const done = new Set<string>();
  const isReady = (slice: PlannedSlice): boolean =>
    !done.has(slice.name) && (order.waitsFor.get(slice.name) ?? []).every((name) => done.has(name));
  for (let ready = order.slices.filter(isReady); ready.length > 0; ready = order.slices.filter(isReady)) {
    placed.push(...ready);
    ready.forEach((slice) => done.add(slice.name));
  }
  return placed;
}

function unorderedPairs(order: Order): readonly UnorderedPair[] {
  return order.slices.flatMap((one, at) =>
    order.slices
      .slice(at + 1)
      .filter((other) => !isOrdered(order, one.name, other.name))
      .map((other): UnorderedPair => ({ slices: [one, other], shared: scopesShare(one.scope, other.scope) })),
  );
}

function pairKey(one: string, other: string): string {
  return [one, other].sort().join(" ");
}

function wavesOf(order: Order, placed: readonly PlannedSlice[], pairs: readonly UnorderedPair[]): readonly Wave[] {
  const apart = new Set(
    pairs
      .filter((pair) => pair.shared.kind === "share no path")
      .map((pair) => pairKey(pair.slices[0].name, pair.slices[1].name)),
  );
  const waveOf = new Map<string, number>();
  for (const slice of placed) {
    const before = (order.waitsFor.get(slice.name) ?? []).map((name) => waveOf.get(name) ?? 0);
    let wave = Math.max(0, ...before) + 1;
    const inWave = (number: number): readonly string[] =>
      [...waveOf].filter(([, at]) => at === number).map(([name]) => name);
    while (inWave(wave).some((name) => !apart.has(pairKey(name, slice.name)))) {
      wave += 1;
    }
    waveOf.set(slice.name, wave);
  }
  const numbers = [...new Set(waveOf.values())].sort((one, other) => one - other);
  return numbers.map((number) => {
    const slices = order.slices.filter((slice) => waveOf.get(slice.name) === number).map((slice) => slice.name);
    return { wave: number, slices, builders: slices.length };
  });
}

function longestChainOf(order: Order, placed: readonly PlannedSlice[]): readonly string[] {
  const chains = new Map<string, readonly string[]>();
  const longer = (best: readonly string[], chain: readonly string[]): readonly string[] =>
    chain.length > best.length ? chain : best;
  for (const slice of placed) {
    const behind = (order.waitsFor.get(slice.name) ?? []).map((name) => chains.get(name) ?? []);
    chains.set(slice.name, [...behind.reduce(longer, []), slice.name]);
  }
  return order.slices.map((slice) => chains.get(slice.name) ?? []).reduce(longer, []);
}

function cycleProblems(order: Order, notPlaced: readonly string[]): readonly Problem[] {
  const found = new Map<string, readonly string[]>();
  for (const name of notPlaced) {
    if (order.behind.get(name)?.has(name) === true) {
      const members = notPlaced.filter(
        (other) => order.behind.get(name)?.has(other) === true && order.behind.get(other)?.has(name) === true,
      );
      found.set(members.join(" "), members);
    }
  }
  return [...found.values()].map((members) => cycle(members));
}

function unknownAfterProblems(plan: Plan): readonly Problem[] {
  const names = new Set(plan.slices.map((slice) => slice.name));
  return plan.slices.flatMap((slice) =>
    slice.after.filter((after) => !names.has(after.slice)).map((after) => afterNamesNoSlice(slice.name, after.slice)),
  );
}

function pairProblems(pairs: readonly UnorderedPair[]): readonly Problem[] {
  return pairs.flatMap((pair) => sharedScopes([pair.slices[0].name, pair.slices[1].name], pair.shared) ?? []);
}

function admitsEveryFile(scope: readonly string[], files: readonly string[]): boolean {
  return files.every((file) => scope.some((pattern) => pathMatch(pattern, file).kind === "matched"));
}

function wholeFeatureProblems(plan: Plan, features: readonly Feature[]): readonly Problem[] {
  const reached = (slice: PlannedSlice): readonly Feature[] =>
    features.filter((feature) => feature.private.length > 0 && admitsEveryFile(slice.scope, feature.private));
  return plan.slices.flatMap((slice) => reached(slice).map((feature) => wholeFeature(slice.name, feature.name)));
}

function isOneAfterAnother(plan: Plan, placed: readonly PlannedSlice[], chain: readonly string[]): boolean {
  const count = plan.slices.length;
  return count > 1 && placed.length === count && chain.length === count && plan.oneAfterAnotherBecause === undefined;
}

export function workOut(plan: Plan, features: readonly Feature[]): WorkedOut {
  const order = orderOf(plan);
  const placed = placeableInOrder(order);
  const notPlaced = plan.slices.filter((slice) => !placed.includes(slice)).map((slice) => slice.name);
  const pairs = unorderedPairs(order);
  const longestChain = longestChainOf(order, placed);
  const problems = [
    ...unknownAfterProblems(plan),
    ...cycleProblems(order, notPlaced),
    ...pairProblems(pairs),
    ...wholeFeatureProblems(plan, features),
    ...(isOneAfterAnother(plan, placed, longestChain) ? [oneAfterAnother()] : []),
  ];
  return { waves: wavesOf(order, placed, pairs), notPlaced, longestChain, problems };
}
