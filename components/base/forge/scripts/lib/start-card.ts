import type { Dropped } from "./branch-endings.ts";
import { computed, counted, joined, shortCommit, type Card } from "./card-lines.ts";
import type { Item, Proof, Slice } from "./slice-form.ts";

export type Planter = "runs" | "none";

export type InterfaceFiles = "named" | "none" | "not asked";

export type StartCardInput = {
  readonly slice: Slice;
  readonly title: string;
  readonly base: string;
  readonly bugs: readonly string[];
  readonly planter: Planter;
  readonly interface: InterfaceFiles;
  readonly leftovers?: readonly Dropped[];
};

const heldSaid: Readonly<Record<Proof["kind"], string>> = {
  checks: "checks",
  "fails-first": "a test fails first",
  "bugs-caught": "bugs caught",
  "same-output": "same output",
  count: "a count",
  "real-thing": "the real thing",
};

function scopeWords(scope: readonly string[]): string {
  const [first = "", ...rest] = scope;
  return rest.length === 0 ? `scope: ${first}` : `scope: ${first} and ${counted(rest.length, "more path")}`;
}

function interfaceWords(files: InterfaceFiles): readonly string[] {
  return files === "none" ? ["interface: none named, so the test writer and the builder get no agreed shape"] : [];
}

function countWords(proof: Extract<Proof, { readonly kind: "count" }>): string {
  if ("use" in proof) {
    return `the settings' count ${proof.use}: no rise`;
  }
  const limit = "most" in proof ? `at most ${String(proof.most)}` : "no rise";
  return `lines with "${proof.pattern}" in ${proof.paths.join(", ")}: ${limit}`;
}

function differWords(differ: readonly string[]): string {
  const compared = "compares the settings' commands";
  return differ.length === 0 ? compared : `${compared}; ${differ.join(", ")} must differ`;
}

function shownProof(proof: Proof): readonly string[] {
  switch (proof.kind) {
    case "checks":
    case "bugs-caught":
      return [];
    case "fails-first":
      return [`tests: ${proof.tests.join(", ")}`];
    case "same-output":
      return [differWords(proof.differ)];
    case "count":
      return [countWords(proof)];
    case "real-thing":
      return [`${counted(proof.runs.length, "run")}: ${proof.runs.map((run) => `bay ${run.bay[0] ?? ""}`).join(", ")}`];
  }
}

function itemWords(item: Item): readonly string[] {
  const opening = `${item.id}, ${item.level}: ${item.says}`;
  if (item.proof === undefined) {
    return [opening, "held by: your judgement"];
  }
  return [opening, `held by: ${heldSaid[item.proof.kind]}`, ...shownProof(item.proof)];
}

function bugsAskedBy(slice: Slice): readonly string[] {
  return slice.done.filter((item) => item.proof?.kind === "bugs-caught").map((item) => item.id);
}

function plantedWords(named: readonly string[]): readonly string[] {
  if (named.length === 0) {
    return ["bugs: none named, so the planter writes them after the last round"];
  }
  return [...named, "the planter writes more after the last round"];
}

function bugsWords(input: StartCardInput): readonly string[] {
  const { bugs, planter } = input;
  const asking = bugsAskedBy(input.slice);
  const named = bugs.length === 0 ? [] : [`${counted(bugs.length, "bug")} to inject: ${bugs.join("; ")}`];
  if (asking.length > 0 && planter === "runs") {
    return plantedWords(named);
  }
  if (named.length > 0) {
    return named;
  }
  return asking.length === 0
    ? ["bugs: none will be planted"]
    : [`bugs: none named, so ${joined(asking)} will not be known`];
}

export function leftoverWords(leftovers: readonly Dropped[]): readonly string[] {
  if (leftovers.length === 0) {
    return [];
  }
  const each = leftovers.map((left) => `an earlier run left ${left.branch} at ${shortCommit(left.commit)}`);
  return [...each, "building over drops them and gives each commit in full, so their work can be found again"];
}

export function startCard(input: StartCardInput): Card {
  const { slice, title, base } = input;
  const afters = slice.after.map((after) => `after ${after.slice}: ${after.because}`);
  const words = [
    title,
    `kind ${slice.kind}; base ${base}`,
    scopeWords(slice.scope),
    ...interfaceWords(input.interface),
    ...(afters.length === 0 ? ["after no other slice"] : afters),
    ...slice.done.flatMap(itemWords),
    ...bugsWords(input),
    ...leftoverWords(input.leftovers ?? []),
  ];
  return { title: `Build slice ${slice.name}?`, lines: words.map((said) => computed("slice", said)) };
}
