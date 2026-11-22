import { computed, joined, shortCommit, shortened, type CardLine, type ComputedBy } from "./card-lines.ts";
import type { Result, Side } from "./tried-examples.ts";
import type { TriedBlock } from "./tried-block.ts";

type Outcome = Result["outcome"];

type Verdict = "passed" | "failed" | "not known" | "none tried";

const says = "The design's examples answer as designed.";

const longestSide = 120;

const longestReason = 240;

const comparedWords =
  "compared: an answer whole, as JSON; a refusal by its exact sentence; the earlier calls set up the state " +
  "and are not compared";

const offWords = "the design's examples: not tried, since settings.forge.tryExamples is off";

const noneWords =
  "the design's examples: none, since the slice's request carries none of a design's examples; nothing is " +
  "withheld for them";

function countOf(results: readonly Result[], outcome: Outcome): number {
  return results.filter((result) => result.outcome === outcome).length;
}

function triedCount(results: readonly Result[]): number {
  return results.length - countOf(results, "not tried");
}

function verdictOf(results: readonly Result[]): Verdict {
  if (countOf(results, "otherwise") > 0) {
    return "failed";
  }
  if (countOf(results, "not known") > 0) {
    return "not known";
  }
  return triedCount(results) === 0 ? "none tried" : "passed";
}

function levelOf(block: TriedBlock): string {
  return block.setting === "must" ? "must" : "should";
}

function exampleName(result: Result): string {
  return `${result.action} example ${String(result.number)}`;
}

function talliedWords(results: readonly Result[]): string {
  const counts: readonly (readonly [Outcome, string])[] = [
    ["refused by its schema", "refused by the request schema before the mode ran, their sentences not compared"],
    ["otherwise", "answered otherwise"],
    ["not known", "not known"],
  ];
  const shown = counts.flatMap(([outcome, words]) => {
    const count = countOf(results, outcome);
    return count === 0 ? [] : [`${String(count)} ${words}`];
  });
  return [`${String(countOf(results, "as designed"))} answered as the design says`, ...shown].join(", ");
}

function summaryWords(block: TriedBlock): string {
  const { results } = block;
  const notTried = countOf(results, "not tried");
  const left = notTried === 0 ? "" : `; ${String(notTried)} not tried`;
  const tried = triedCount(results);
  if (tried === 0) {
    return `the design's examples: none tried${left}`;
  }
  return (
    `the design's examples: ${String(tried)} tried by bay call, each in a fresh throwaway copy of ` +
    `${shortCommit(block.head)}, which limits where the calls write by convention only; ${talliedWords(results)}${left}`
  );
}

function designedWords(side: Side): string {
  const text = shortened(side.text, longestSide);
  return side.how === "answers" ? `the design answers ${text}` : `the design refuses ${JSON.stringify(text)}`;
}

function builtWords(side: Side): string {
  if (side.kept === true) {
    return `the built mode ${side.how}: ${side.text}`;
  }
  return `the built mode ${side.how}: ${JSON.stringify(shortened(side.text, longestSide))}`;
}

function resultWords(result: Result): readonly string[] {
  switch (result.outcome) {
    case "otherwise":
      return [`${exampleName(result)}: ${designedWords(result.designed)}; ${builtWords(result.built)}`];
    case "not known":
      return [`not known: ${exampleName(result)}: ${shortened(result.reason, longestReason)}`];
    case "refused by its schema":
      return [`refused by the request schema, its sentence not compared: ${exampleName(result)}`];
    case "as designed":
    case "not tried":
      return [];
  }
}

type NotTried = Result & { readonly outcome: "not tried" };

function isNotTried(result: Result): result is NotTried {
  return result.outcome === "not tried";
}

function groupWords(group: readonly NotTried[]): string {
  const [first] = group;
  const numbers = joined(group.map((result) => String(result.number)));
  const named = `${first?.action ?? ""} ${group.length === 1 ? "example" : "examples"} ${numbers}`;
  return `not tried: ${named}: ${shortened(first?.reason ?? "", longestReason)}`;
}

function notTriedWords(results: readonly Result[]): readonly string[] {
  const groups = new Map<string, NotTried[]>();
  for (const result of results.filter(isNotTried)) {
    const key = `${result.action}\n${result.reason}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.values()].map(groupWords);
}

export function examplesWords(block: TriedBlock | undefined): readonly string[] {
  if (block === undefined) {
    return [];
  }
  if (block.setting === "off") {
    return [offWords];
  }
  if (!block.carried) {
    return [noneWords];
  }
  const { results } = block;
  return [
    `examples, ${levelOf(block)}, ${verdictOf(results)}: ${says}`,
    summaryWords(block),
    ...(triedCount(results) === 0 ? [] : [comparedWords]),
    ...results.flatMap(resultWords),
    ...notTriedWords(results),
  ];
}

export function examplesLines(block: TriedBlock | undefined, provedBy: ComputedBy): readonly CardLine[] {
  return examplesWords(block).map((said) => computed(provedBy, said));
}

export function withholdingWords(block: TriedBlock): readonly string[] {
  if (block.setting !== "must" || !block.carried) {
    return [];
  }
  const withholding = block.results.filter(
    (result) => result.outcome === "otherwise" || result.outcome === "not known",
  );
  return withholding.flatMap(resultWords);
}

export type ExampleCounts = Readonly<Record<Outcome, number>>;

export function exampleCounts(blocks: readonly TriedBlock[]): ExampleCounts {
  const results = blocks.filter((block) => block.carried && block.setting !== "off").flatMap((block) => block.results);
  return {
    "as designed": countOf(results, "as designed"),
    "refused by its schema": countOf(results, "refused by its schema"),
    otherwise: countOf(results, "otherwise"),
    "not known": countOf(results, "not known"),
    "not tried": countOf(results, "not tried"),
  };
}

function countClause(count: number, examples: string, said: string): readonly string[] {
  return count === 0 ? [] : [`${String(count)} of ${examples} ${said}`];
}

export function examplesClauses(block: TriedBlock | undefined, whose = ""): readonly string[] {
  if (block === undefined || block.setting !== "must" || !block.carried) {
    return [];
  }
  const examples = whose === "" ? "the design's examples" : `${whose}'s examples`;
  const { results } = block;
  if (triedCount(results) === 0) {
    return [`none of ${examples} was tried`];
  }
  const unknown = countOf(results, "not known");
  return [
    ...countClause(countOf(results, "otherwise"), examples, "answered otherwise"),
    ...countClause(unknown, examples, unknown === 1 ? "is not known" : "are not known"),
  ];
}
