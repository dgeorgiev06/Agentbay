import { pathMatch } from "../../../../../bay/sdk.ts";

export type SharedPath =
  | { readonly kind: "share no path" }
  | { readonly kind: "share a path"; readonly patterns: readonly [string, string]; readonly example: string }
  | { readonly kind: "may share a path"; readonly patterns: readonly [string, string]; readonly reason: string };

type Part = { readonly kind: "any folders" } | { readonly kind: "name"; readonly pattern: string };

type Place = {
  readonly first: number;
  readonly second: number;
  readonly names: readonly string[];
};

type Move = {
  readonly here: number;
  readonly there: number;
  readonly name?: string;
};

type NamePieces = {
  readonly prefix: string;
  readonly middles: readonly string[];
  readonly suffix: string;
};

const anyFolders: Part = { kind: "any folders" };

const somewhere = "x";

const noPath: SharedPath = { kind: "share no path" };

function partsOf(pattern: string): readonly Part[] {
  const names = pattern.split("/").filter((name) => name !== ".");
  const parts = names.map((name): Part => (name === "**" ? anyFolders : { kind: "name", pattern: name }));
  if (names.at(-1) !== "**") {
    return parts;
  }
  return [...parts.slice(0, -1), { kind: "name", pattern: "*" }, anyFolders];
}

function piecesOf(pattern: string): NamePieces {
  const pieces = pattern.split("*");
  return { prefix: pieces[0] ?? "", middles: pieces.slice(1, -1), suffix: pieces.at(-1) ?? "" };
}

function longerStart(first: string, second: string): string | undefined {
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  return longer.startsWith(shorter) ? longer : undefined;
}

function longerEnd(first: string, second: string): string | undefined {
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  return longer.endsWith(shorter) ? longer : undefined;
}

function nameOfBoth(first: string, second: string): string | undefined {
  if (!first.includes("*")) {
    return pathMatch(second, first).kind === "matched" ? first : undefined;
  }
  if (!second.includes("*")) {
    return pathMatch(first, second).kind === "matched" ? second : undefined;
  }
  const one = piecesOf(first);
  const other = piecesOf(second);
  const prefix = longerStart(one.prefix, other.prefix);
  const suffix = longerEnd(one.suffix, other.suffix);
  if (prefix === undefined || suffix === undefined) {
    return undefined;
  }
  return [prefix, ...one.middles, ...other.middles, somewhere, suffix].join("");
}

function nameOf(pattern: string): string {
  return pattern.replaceAll("*", somewhere);
}

function movesPastFolders(part: Part | undefined, facing: Part | undefined): readonly Move[] {
  if (part?.kind !== "any folders") {
    return [];
  }
  const skip: Move = { here: 1, there: 0 };
  return facing?.kind === "name" ? [skip, { here: 0, there: 1, name: nameOf(facing.pattern) }] : [skip];
}

function movesOnNames(part: Part | undefined, facing: Part | undefined): readonly Move[] {
  if (part?.kind !== "name" || facing?.kind !== "name") {
    return [];
  }
  const name = nameOfBoth(part.pattern, facing.pattern);
  return name === undefined ? [] : [{ here: 1, there: 1, name }];
}

function swapped(move: Move): Move {
  return { ...move, here: move.there, there: move.here };
}

function stepsFrom(first: readonly Part[], second: readonly Part[], place: Place): readonly Place[] {
  const one = first[place.first];
  const other = second[place.second];
  const moves = [
    ...movesPastFolders(one, other),
    ...movesPastFolders(other, one).map(swapped),
    ...movesOnNames(one, other),
  ];
  return moves.map((move) => ({
    first: place.first + move.here,
    second: place.second + move.there,
    names: move.name === undefined ? place.names : [...place.names, move.name],
  }));
}

function pathInBoth(first: readonly Part[], second: readonly Part[]): string | undefined {
  const seen = new Set<string>();
  const waiting: Place[] = [{ first: 0, second: 0, names: [] }];
  for (let place = waiting.shift(); place !== undefined; place = waiting.shift()) {
    const key = `${String(place.first)} ${String(place.second)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (place.first === first.length && place.second === second.length && place.names.length > 0) {
      return place.names.join("/");
    }
    waiting.push(...stepsFrom(first, second, place));
  }
  return undefined;
}

function notAPattern(pattern: string): string | undefined {
  const matched = pathMatch(pattern, somewhere);
  return matched.kind === "not a pattern" ? matched.reason : undefined;
}

function patternsShare(first: string, second: string): SharedPath {
  const patterns = [first, second] as const;
  const fault = notAPattern(first) ?? notAPattern(second);
  if (fault !== undefined) {
    return { kind: "may share a path", patterns, reason: fault };
  }
  const example = pathInBoth(partsOf(first), partsOf(second));
  if (example === undefined) {
    return noPath;
  }
  if (pathMatch(first, example).kind === "matched" && pathMatch(second, example).kind === "matched") {
    return { kind: "share a path", patterns, example };
  }
  const reason = `Forge could not tell whether ${first} and ${second} admit a path in common.`;
  return { kind: "may share a path", patterns, reason };
}

export function scopesShare(first: readonly string[], second: readonly string[]): SharedPath {
  const answers = first.flatMap((one) => second.map((other) => patternsShare(one, other)));
  const certain = answers.find((answer) => answer.kind === "share a path");
  return certain ?? answers.find((answer) => answer.kind === "may share a path") ?? noPath;
}
