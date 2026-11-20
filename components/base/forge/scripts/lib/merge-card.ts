import type { BugsOnCard } from "./bug-card.ts";
import type { Built, Missing } from "./builder-answer.ts";
import { computed, counted, grouped, judged, type Card, type CardLine } from "./card-lines.ts";
import { interfaceChanges, interfaceWords, type Pins } from "./interface-pins.ts";
import { verdictLines, type CaseMessages } from "./item-lines.ts";
import type { Leak } from "./leaks.ts";
import { answerWords, mergeReason, withheldReasons, type WithheldChoice } from "./merge-choices.ts";
import { mustNotHeld, reviewedPracticeLines } from "./practices-block.ts";
import type { Proved, Sized } from "./proof-answer.ts";
import type { RoundsOnCard } from "./round-card.ts";
import { bugWords, leakWords, roundsRanWords } from "./slice-words.ts";
import type { Slice } from "./slice-form.ts";

type Kept = "set-aside" | "with-tests";

const noPins: Pins = { base: [], head: [] };

export type MergeCardInput = {
  readonly slice: Slice;
  readonly proof: Proved;
  readonly built: Built;
  readonly builtAt: string;
  readonly work: string;
  readonly kept: Kept;
  readonly caseMessages: CaseMessages;
  readonly into: string;
  readonly rounds?: RoundsOnCard;
  readonly bugs?: BugsOnCard;
  readonly leaks?: readonly Leak[];
  readonly mustPractices?: readonly string[];
  readonly pins?: Pins;
};

export type Drawn = {
  readonly card: Card & { readonly withheld: Partial<Record<WithheldChoice, string>> };
  readonly merge: boolean;
  readonly sendBack: false;
  readonly discard: false;
};

const lacksSaid: Readonly<Record<Missing["lacks"], string>> = {
  kernel: "the kernel",
  toolbox: "the toolbox",
  "test-toolbox": "the test toolbox",
  interface: "an interface",
};

const watchedPaths: readonly { readonly matches: RegExp; readonly says: string }[] = [
  { matches: /^components\/base\/[^/]+\/mode\.yaml$/, says: "base mode manifest changed, its list needs no trust" },
  { matches: /^bay\//, says: "kernel file changed" },
  { matches: /^adapters\//, says: "adapter file changed" },
  { matches: /^schemas\//, says: "kit schema changed" },
];

function changedWords(size: readonly Sized[], work: string, kept: Kept): string {
  const changed = size.length === 0 ? "what changed is not known" : `${counted(size.length, "file")} changed`;
  const where = kept === "set-aside" ? `the work is set aside on ${work}` : `the work and the tests are on ${work}`;
  return `${changed}; ${where}`;
}

function topOf(path: string): string {
  const slash = path.indexOf("/");
  return slash < 0 ? path : path.slice(0, slash + 1);
}

function signed(count: number): string {
  return count < 0 ? `-${grouped(-count)}` : `+${grouped(count)}`;
}

function sizeWords(size: readonly Sized[]): readonly string[] {
  if (size.length === 0) {
    return [];
  }
  const net = new Map<string, number>();
  for (const sized of size) {
    const top = topOf(sized.path);
    net.set(top, (net.get(top) ?? 0) + (sized.head ?? 0) - (sized.base ?? 0));
  }
  const tops = [...net].map(([top, lines]) => `${top} ${signed(lines)}`);
  return [`size in lines: ${tops.join(", ")}`];
}

function watchedWords(size: readonly Sized[]): readonly string[] {
  return size.flatMap((sized) => {
    const watched = watchedPaths.find((each) => each.matches.test(sized.path));
    return watched === undefined ? [] : [`${watched.says}: ${sized.path}`];
  });
}

function roundLines(rounds: RoundsOnCard | undefined): readonly CardLine[] {
  if (rounds === undefined) {
    return [];
  }
  const ran = roundsRanWords(rounds);
  const { judged: lines } = rounds;
  if (lines === undefined) {
    return [computed("draw", ran)];
  }
  const when = `the reviewer, in round ${String(lines.round)}, before the final proof:`;
  const sentences = lines.sentences.map((words) => judged(lines.step, words));
  return [computed("draw", ran), computed("draw", when), ...sentences];
}

function builderLines(built: Built, step: string): readonly CardLine[] {
  const stopped =
    built.outcome === "stopped"
      ? [`the builder stopped, saying ${lacksSaid[built.missing.lacks]} lacks ${built.missing.name}`]
      : [];
  const decided = (built.decisions ?? []).map((decision) => `the builder decided: ${decision}`);
  return [...stopped, ...decided].map((words) => judged(step, words));
}

function drawnLines(input: MergeCardInput, reason: string | undefined): readonly CardLine[] {
  const { slice, proof, work, kept, pins = noPins } = input;
  const drawnWords = [
    changedWords(proof.size, work, kept),
    ...sizeWords(proof.size),
    ...watchedWords(proof.size),
    ...interfaceWords(pins),
  ];
  return [
    computed("draw", answerWords(reason)),
    ...(input.leaks ?? []).map((leak) => computed("draw", leakWords(leak))),
    ...verdictLines(slice, proof.verdicts, { messages: input.caseMessages, provedBy: "prove" }),
    ...reviewedPracticeLines(input.rounds, input.mustPractices ?? []),
    ...[...drawnWords, ...bugWords(input.bugs)].map((said) => computed("draw", said)),
    ...roundLines(input.rounds),
    ...builderLines(input.built, input.builtAt),
  ];
}

export function drawn(input: MergeCardInput): Drawn {
  const reason = mergeReason({
    slice: input.slice,
    verdicts: input.proof.verdicts,
    built: input.built,
    leaked: (input.leaks ?? []).length > 0,
    mustNotHeld: mustNotHeld(input.rounds, input.mustPractices ?? []),
    interfaceChanges: interfaceChanges(input.pins ?? noPins),
  });
  return {
    card: {
      title: `Merge ${input.slice.name} into ${input.into}?`,
      lines: drawnLines(input, reason),
      withheld: withheldReasons(reason),
    },
    merge: reason === undefined,
    sendBack: false,
    discard: false,
  };
}
