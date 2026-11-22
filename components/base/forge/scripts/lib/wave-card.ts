import type { Stayed } from "./branch-endings.ts";
import {
  capitalized,
  computedWhole,
  counted,
  facts,
  inItem,
  joined,
  judgedWhole,
  sentenced,
  shortFacts,
  type CardLine,
  type ComputedBy,
  type Fact,
  type Screen,
} from "./card-lines.ts";
import { exampleCounts, examplesClauses, examplesWords, withholdingWords } from "./examples-card.ts";
import { gateClauses, gateRanOf } from "./gate-card.ts";
import type { Gate } from "./gate.ts";
import { fastChecksLine, gateLine } from "./gate-words.ts";
import { interfaceWords } from "./interface-pins.ts";
import { itemOpening, itemsSaid, passedCounts, screenItemWords, type ItemSaid } from "./item-lines.ts";
import { builderWords, whereWords } from "./merge-card.ts";
import { notHeldWords } from "./practice-answers.ts";
import { judgedOf, notHeldShown, practicesTallyWords } from "./practices-block.ts";
import type { Verdict } from "./proof-answer.ts";
import type { Reviewed, RoundsOnCard } from "./round-card.ts";
import { bugWords, leakWords, roundsRanWords } from "./slice-words.ts";
import type { GateShown } from "./start-card.ts";
import type { SliceTried } from "./tried-block.ts";
import {
  aloneWords,
  checksVerdict,
  waveAnswer,
  type Alone,
  type Checked,
  type Joined,
  type WaveChecks,
} from "./wave-answer.ts";
import { isIncluded, type Settled } from "./wave-standing.ts";

export type WaveCardInput = {
  readonly wave: number;
  readonly into: string;
  readonly slices: readonly Settled[];
  readonly joined: Joined;
  readonly checks: WaveChecks;
  readonly alone: readonly Alone[];
  readonly must: readonly string[];
  readonly tried?: readonly SliceTried[];
  readonly gate?: GateShown;
  readonly stayed?: readonly Stayed[];
};

export type WaveDrawn = {
  readonly card: Screen & { readonly withheld: { readonly merge?: string } };
  readonly merge: boolean;
};

const plainTitle = /^[\x20-\x7e]+$/;

const combinedAbout = "the checks on the slices combined";

const untriedWords = "the design's examples: not tried, since no combined head was proved to try them on";

function branchStayed(stayed: Stayed): string {
  return `the branch ${stayed.branch} stayed: ${stayed.reason}`;
}

function said(step: ComputedBy, words: string): CardLine {
  return computedWhole(step, sentenced(words));
}

function drawn(words: readonly string[]): readonly CardLine[] {
  return words.map((each) => said("draw", each));
}

function mergedOf(joinedHead: Joined): readonly string[] {
  return joinedHead.kind === "combined" ? joinedHead.merged : [];
}

function triedOf(input: WaveCardInput, name: string): SliceTried | undefined {
  return (input.tried ?? []).find((each) => each.slice === name);
}

function ownItems(checked: Checked): readonly ItemSaid[] {
  return itemsSaid(checked.slice, checked.proof.verdicts);
}

function checkedItems(checked: Checked): readonly ItemSaid[] {
  const ids = checked.slice.done.map((item) => item.id);
  return itemsSaid(
    checked.slice,
    checked.proof.verdicts.filter((verdict) => ids.includes(verdict.item)),
  );
}

function unmet(items: readonly ItemSaid[]): readonly ItemSaid[] {
  return items.filter((item) => item.level === "must" && (item.said === "failed" || item.said === "not known"));
}

function unmetWords(whose: string, items: readonly ItemSaid[]): readonly string[] {
  return unmet(items).map((item) => `${whose}: ${itemOpening(item)}, as ${item.why ?? ""}`);
}

function leftOutProblems(settled: Settled): readonly string[] {
  if (isIncluded(settled)) {
    return [];
  }
  const items = ownItems({ slice: settled.own, proof: settled.proof });
  return [`${settled.name} is left out: ${settled.reason ?? ""} Its branches stay`, ...unmetWords(settled.name, items)];
}

function joinProblems(joinedHead: Joined): readonly string[] {
  switch (joinedHead.kind) {
    case "combined":
      return [];
    case "conflict":
      return [
        `${joinedHead.slice} does not merge cleanly onto ${joined(joinedHead.onto)} in the combined head: ` +
          joinedHead.reason,
      ];
    case "nothing to join":
      return ["No slice passed its own proof, so there is no combined head"];
  }
}

function checksProblems(input: WaveCardInput): readonly CardLine[] {
  const { checks } = input;
  if (checks.kind !== "asked" || checksVerdict(checks) === "passed") {
    return [];
  }
  const items = unmetWords("The checks on the slices combined", checkedItems(checks));
  return [...items.map((words) => said("prove", words)), ...drawn(aloneWords(input.alone))];
}

function examplesProblems(tried: readonly SliceTried[]): readonly string[] {
  return tried.flatMap((block) => withholdingWords(block).map((words) => `${block.slice}'s ${words}`));
}

function scopedBy(input: WaveCardInput): readonly (readonly Verdict[])[] {
  const combined = input.checks.kind === "asked" ? input.checks.proof.verdicts : [];
  return [combined, ...input.slices.filter(isIncluded).map((settled) => settled.proof.verdicts)];
}

function gateProblems(input: WaveCardInput): readonly string[] {
  return input.checks.kind === "asked" ? gateClauses(input.gate, scopedBy(input)) : [];
}

function problemFacts(input: WaveCardInput): readonly Fact[] {
  const lines = [
    ...drawn([...input.slices.flatMap(leftOutProblems), ...joinProblems(input.joined)]),
    ...checksProblems(input),
    ...drawn([...examplesProblems(input.tried ?? []), ...gateProblems(input)]),
  ];
  return facts("problems", lines);
}

function changedPaths(slices: readonly Settled[]): readonly string[] {
  return [...new Set(slices.filter(isIncluded).flatMap((settled) => settled.proof.size.map((sized) => sized.path)))];
}

function headWords(joinedHead: Joined, slices: readonly Settled[]): readonly string[] {
  if (joinedHead.kind !== "combined") {
    return ["No combined head"];
  }
  const files = changedPaths(slices).length;
  return [
    `In the combined head: ${String(joinedHead.merged.length)} of ${counted(slices.length, "slice")}`,
    files === 0 ? "What changed is not known" : `${counted(files, "file")} changed`,
    `The work is on ${joinedHead.branch}`,
  ];
}

function combinedWords(joinedHead: Joined): string {
  switch (joinedHead.kind) {
    case "combined":
      return (
        `The combined head is ${joinedHead.head} on ${joinedHead.branch}, ` +
        `with ${joinedHead.merged.join(", ")} merged in plan order`
      );
    case "conflict":
      return `The combined head stopped at ${joinedHead.slice}: ${joinedHead.reason}`;
    case "nothing to join":
      return "There is no combined head: no slice passed its own proof";
  }
}

function placeWords(settled: Settled, merged: readonly string[]): string {
  const where = whereWords(settled.work, settled.builder);
  if (!isIncluded(settled)) {
    return `${settled.name} is left out; ${where}`;
  }
  return merged.includes(settled.name)
    ? `${settled.name} is in the combined head; ${where}`
    : `${settled.name} passed its own proof and is not in the combined head; ${where}`;
}

function sliceWhatFacts(settled: Settled, item: number, merged: readonly string[]): readonly Fact[] {
  const files = settled.proof.size.length;
  const computedWords = [
    placeWords(settled, merged),
    files === 0 ? "What it changed is not known" : `It changed ${counted(files, "file")}`,
    ...interfaceWords(settled.pins),
    ...bugWords(settled.bugs),
    ...settled.leaks.map(leakWords),
    ...settled.stayed.map(branchStayed),
    roundsRanWords(settled.rounds),
  ];
  const builder = builderWords(settled.built).map((words) => judgedWhole(settled.builtAt, sentenced(words)));
  return facts("what", [...drawn(computedWords), ...inItem(item, builder)], `slice ${settled.name}`);
}

function whatFacts(input: WaveCardInput): readonly Fact[] {
  const merged = mergedOf(input.joined);
  const stayed = (input.stayed ?? []).map(branchStayed);
  return [
    ...shortFacts("what", drawn(headWords(input.joined, input.slices))),
    ...facts("what", drawn([combinedWords(input.joined)]), "the combined head"),
    ...input.slices.flatMap((settled, item) => sliceWhatFacts(settled, item, merged)),
    ...(stayed.length === 0 ? [] : facts("what", drawn(stayed), "branches that stayed")),
  ];
}

function checksShortWords(checks: WaveChecks): string {
  if (checks.kind === "not asked") {
    return "The checks did not run";
  }
  switch (checksVerdict(checks)) {
    case "passed": {
      const counts = checks.proof.verdicts.map(passedCounts).find((each) => each !== undefined);
      if (counts === undefined) {
        return "The checks passed";
      }
      const passed = counts.bayCheck ? "The checks and bay check passed" : "The checks passed";
      return `${passed}: ${counted(counts.tests, "test")}`;
    }
    case "failed":
      return "The checks failed";
    case "not known":
      return "The checks are not known";
  }
}

function gateShortWords(gate: Gate, verdicts: readonly Verdict[]): string {
  if (gate.gate === "whole") {
    return "Ran: every test of the project";
  }
  switch (gateRanOf(verdicts)) {
    case "chosen":
      return `Not run: tests outside the ${gate.mode} mode`;
    case "no own test":
      return `The ${gate.mode} mode has no test of its own`;
    case "every test":
      return "Proof says every test ran";
    case "not said":
      return "Which tests ran is not said";
  }
}

function examplesShortWords(tried: readonly SliceTried[]): readonly string[] {
  const counts = exampleCounts(tried);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return [];
  }
  const others = [
    ...(counts.otherwise === 0 ? [] : [`${String(counts.otherwise)} otherwise`]),
    ...(counts["not known"] === 0 ? [] : [`${String(counts["not known"])} not known`]),
    ...(counts["not tried"] === 0 ? [] : [`${String(counts["not tried"])} not tried`]),
    ...(counts["refused by its schema"] === 0 ? [] : [`${String(counts["refused by its schema"])} refused`]),
  ];
  return [`Examples: ${[`${String(counts["as designed"])} as designed`, ...others].join(", ")}`];
}

function reviewedOf(rounds: RoundsOnCard): Reviewed | undefined {
  return rounds.judged?.reviewed;
}

function reviewShortWords(slices: readonly Settled[]): string {
  const reviewed = slices.flatMap((settled) => reviewedOf(settled.rounds) ?? []);
  if (reviewed.length === 0) {
    return "The review step did not run";
  }
  const sum = (count: (each: Reviewed) => number): number => reviewed.reduce((total, each) => total + count(each), 0);
  const held = sum((each) => each.held);
  const all = held + sum((each) => each.notHeld);
  return `Review step: ${String(held)} of ${String(all)} held, ${counted(
    sum((each) => each.remaining),
    "finding",
  )} left`;
}

function shortChecks(input: WaveCardInput): readonly Fact[] {
  const { checks, gate } = input;
  const verdicts = checks.kind === "asked" ? checks.proof.verdicts : [];
  const gateWords = gate === undefined || checks.kind !== "asked" ? [] : [gateShortWords(gate.gate, verdicts)];
  const words = [
    checksShortWords(checks),
    ...gateWords,
    ...examplesShortWords(input.tried ?? []),
    reviewShortWords(input.slices),
  ];
  return shortFacts("checks", drawn(words));
}

function itemLines(items: readonly ItemSaid[], step: ComputedBy): readonly CardLine[] {
  return items.flatMap((item) => screenItemWords(item).map((words) => said(step, words)));
}

function gateWords(input: WaveCardInput): readonly string[] {
  const { gate, checks } = input;
  if (gate === undefined || checks.kind !== "asked") {
    return [];
  }
  const names = input.slices.map((settled) => settled.name);
  return [
    gateLine(gate.gate, names, gateRanOf(checks.proof.verdicts)),
    ...fastChecksLine(gate.gate, gate.alsoRun),
    ...gateClauses(gate, scopedBy(input)),
  ];
}

function combinedChecks(input: WaveCardInput): readonly Fact[] {
  const { checks } = input;
  const items = checks.kind === "asked" ? itemLines(checkedItems(checks), "prove") : [];
  return facts("checks", [...items, ...drawn(gateWords(input))], combinedAbout);
}

function aloneFacts(alone: readonly Alone[]): readonly Fact[] {
  return alone.flatMap((proved) =>
    facts("checks", itemLines(checkedItems(proved), "draw"), `${proved.name} alone with the checks`),
  );
}

function untriedFacts(input: WaveCardInput): readonly Fact[] {
  const carried = input.slices.some((settled) => settled.carriesExamples === true);
  return (input.tried ?? []).length === 0 && carried
    ? facts("checks", drawn([untriedWords]), "the design's examples")
    : [];
}

function reviewLines(settled: Settled, item: number, must: readonly string[]): readonly CardLine[] {
  const { rounds } = settled;
  const judged = rounds.judged;
  const tally = said("draw", practicesTallyWords(rounds));
  if (judged === undefined) {
    return [tally];
  }
  const notHeld = (judgedOf(rounds)?.notHeld ?? []).map((practice) =>
    judgedWhole(judged.step, sentenced(notHeldWords(notHeldShown(practice, must)))),
  );
  const when = said("draw", `The review step, in round ${String(judged.round)}, before the final proof, wrote these`);
  const sentences = judged.sentences.map((words) => judgedWhole(judged.step, sentenced(words)));
  return [tally, ...inItem(item, notHeld), when, ...inItem(item, sentences)];
}

function sliceChecks(input: WaveCardInput, settled: Settled, item: number): readonly Fact[] {
  const own = itemLines(ownItems({ slice: settled.own, proof: settled.proof }), "draw");
  const tried = triedOf(input, settled.name);
  return [
    ...facts("checks", own, `${settled.name}'s own proof`),
    ...(tried === undefined ? [] : facts("checks", drawn(examplesWords(tried)), `${settled.name}'s examples`)),
    ...facts("checks", reviewLines(settled, item, input.must), `${settled.name}'s review`),
  ];
}

function checkFacts(input: WaveCardInput): readonly Fact[] {
  return [
    ...shortChecks(input),
    ...combinedChecks(input),
    ...aloneFacts(input.alone),
    ...untriedFacts(input),
    ...input.slices.flatMap((settled, item) => sliceChecks(input, settled, item)),
  ];
}

function examplesReason(tried: readonly SliceTried[]): readonly string[] {
  return tried.flatMap((block) => examplesClauses(block, block.slice));
}

function titleOf(input: WaveCardInput): string {
  const into = plainTitle.test(input.into) ? input.into : "the integration branch";
  return `Merge wave ${String(input.wave)} into ${into}?`;
}

export function waveDrawn(input: WaveCardInput): WaveDrawn {
  const gate = input.checks.kind === "asked" ? gateClauses(input.gate, scopedBy(input)) : [];
  const answer = waveAnswer(input.slices, input.joined, {
    checks: input.checks,
    examples: examplesReason(input.tried ?? []),
    gate,
  });
  const withheld = answer.offered ? {} : { merge: capitalized(answer.reason) };
  const lines = [...problemFacts(input), ...whatFacts(input), ...checkFacts(input)];
  return {
    card: { title: titleOf(input), lines, withheld },
    merge: answer.offered,
  };
}
