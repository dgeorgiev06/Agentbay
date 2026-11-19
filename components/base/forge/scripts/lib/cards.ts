import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";

const proofKinds = [
  "checks",
  "fails-first",
  "in-scope",
  "as-declared",
  "bugs-caught",
  "same-output",
  "count",
  "real-thing",
] as const;

export type ProofKind = (typeof proofKinds)[number];

export type Level = "must" | "should";

export type Proof =
  | { readonly kind: "checks" | "bugs-caught" }
  | { readonly kind: "fails-first"; readonly tests: readonly string[] }
  | { readonly kind: "same-output"; readonly differ: readonly string[] }
  | { readonly kind: "count"; readonly pattern: string; readonly paths: readonly string[]; readonly most: number }
  | { readonly kind: "count"; readonly pattern: string; readonly paths: readonly string[]; readonly noRise: true }
  | { readonly kind: "count"; readonly use: string }
  | { readonly kind: "real-thing"; readonly runs: readonly { readonly bay: readonly string[] }[] };

export type Item = {
  readonly id: string;
  readonly says: string;
  readonly level: Level;
  readonly proof?: Proof;
};

export type After = {
  readonly slice: string;
  readonly because: string;
};

export type Slice = {
  readonly name: string;
  readonly kind: "interface" | "capability" | "mode";
  readonly scope: readonly string[];
  readonly after: readonly After[];
  readonly done: readonly Item[];
};

export type FailingNames = {
  readonly names: readonly string[];
  readonly notListed: number;
  readonly notLoaded: number;
};

export type Verdict =
  | { readonly item: string; readonly kind: ProofKind; readonly verdict: "passed"; readonly detail: string }
  | {
      readonly item: string;
      readonly kind: ProofKind;
      readonly verdict: "failed";
      readonly detail: string;
      readonly cases?: FailingNames;
    }
  | { readonly item: string; readonly kind: ProofKind; readonly verdict: "inconclusive"; readonly reason: string };

export type Sized = {
  readonly path: string;
  readonly base?: number;
  readonly head?: number;
};

export type Proved = {
  readonly verdicts: readonly Verdict[];
  readonly size: readonly Sized[];
};

export type Missing = {
  readonly lacks: "kernel" | "toolbox" | "test-toolbox" | "interface";
  readonly name: string;
};

type Decided = {
  readonly decisions?: readonly string[];
};

export type Built = ({ readonly outcome: "built" } | { readonly outcome: "stopped"; readonly missing: Missing }) &
  Decided;

export type CardLine =
  | {
      readonly mark: "computed";
      readonly words: string;
      readonly source: { readonly step: "slice" | "prove" | "draw" };
    }
  | {
      readonly mark: "judged";
      readonly words: string;
      readonly source: { readonly step: string };
    };

export type StartCardInput = {
  readonly slice: Slice;
  readonly title: string;
  readonly base: string;
  readonly bugs: readonly string[];
};

export type StartCard = {
  readonly title: string;
  readonly lines: readonly CardLine[];
};

export type Kept = "set-aside" | "with-tests";

export type JudgedLines = {
  readonly step: string;
  readonly sentences: readonly string[];
};

export type RoundsEnded = "leak" | "stopped" | "no-findings" | "last-round";

export type RoundsOnCard = {
  readonly count: number;
  readonly most: number;
  readonly ended: RoundsEnded;
  readonly judged?: JudgedLines;
};

export type SurvivedBug = {
  readonly name: string;
  readonly files: readonly string[];
};

export type BugsOnCard = {
  readonly planted: number;
  readonly survived: readonly SurvivedBug[];
};

export type Leak =
  | { readonly kind: "shared-text"; readonly path: string; readonly lines: number }
  | { readonly kind: "mark"; readonly path: string }
  | { readonly kind: "mark-in-answer" };

export type MergeCardInput = {
  readonly slice: Slice;
  readonly proof: Proved;
  readonly built: Built;
  readonly builtAt: string;
  readonly work: string;
  readonly kept: Kept;
  readonly into: string;
  readonly rounds?: RoundsOnCard;
  readonly bugs?: BugsOnCard;
  readonly leaks?: readonly Leak[];
};

export type WithheldChoice = "merge" | "send-back" | "discard";

export type Drawn = {
  readonly card: StartCard & { readonly withheld: Partial<Record<WithheldChoice, string>> };
  readonly merge: boolean;
  readonly sendBack: false;
  readonly discard: false;
};

type Unmet = {
  readonly failed: readonly string[];
  readonly notKnown: readonly string[];
};

type ShownItem = {
  readonly id: string;
  readonly level: Level;
  readonly says: string;
  readonly judgement: boolean;
};

type Known = {
  readonly matches: RegExp;
  readonly says: (found: RegExpExecArray) => string;
};

const addedSays: Readonly<Record<string, string>> = {
  scope: "Every changed path is in the write scope.",
  declared: "What changed is as declared.",
};

const sendBackReason = "No round runs after the card.";

const discardReason = "Discarding comes with slice WD1.";

const failedSaid: Readonly<Record<ProofKind, string>> = {
  checks: "a check or the test run failed",
  "fails-first": "the named tests do not fail first and pass after",
  "in-scope": "a changed path is outside the write scope",
  "as-declared": "what changed is not as declared",
  "bugs-caught": "an injected bug survived",
  "same-output": "the output is not as the item says",
  count: "a count does not hold",
  "real-thing": "a run printed other than expected",
};

const checkNamePattern = "([A-Za-z0-9:._-]+)";

const failedSentences: readonly Known[] = [
  { matches: /^The named tests fail on the head\.$/, says: () => "the named tests fail on the head" },
  {
    matches: /^The named tests already pass on the base, so they do not show the change\.$/,
    says: () => "the named tests already pass on the base",
  },
  {
    matches: new RegExp(`^The check ${checkNamePattern} found a fault\\.$`),
    says: (found) => `the check ${found[1] ?? ""} found a fault`,
  },
  { matches: /^(\d+) tests? failed\.$/, says: (found) => `${counted(Number(found[1]), "test")} failed` },
];

const notKnownStarts: readonly Known[] = [
  {
    matches: /^The kind [a-z-]+ is not built in this version of the proof mode/,
    says: () => "proof does not judge this kind yet",
  },
  {
    matches: new RegExp(`^The check ${checkNamePattern} is not known:`),
    says: (found) => `the check ${found[1] ?? ""} is not known`,
  },
  { matches: /^The checks could not start:/, says: () => "the checks could not start" },
  { matches: /^The test run is not known:/, says: () => "the test run is not known" },
  { matches: /^The test run could not start:/, says: () => "the test run could not start" },
  {
    matches: /^The run on the (base|head) is not known:/,
    says: (found) => `the run on the ${found[1] ?? ""} is not known`,
  },
  {
    matches: /^The run on the (base|head) could not start:/,
    says: (found) => `the run on the ${found[1] ?? ""} could not start`,
  },
  {
    matches: /^The named tests could not be laid over the base:/,
    says: () => "the named tests could not be laid over the base",
  },
];

const notKnownSaid = "proof could not tell, so nothing is known";

const noVerdictSaid = "proof gave no verdict";

const lacksSaid: Readonly<Record<Missing["lacks"], string>> = {
  kernel: "the kernel",
  toolbox: "the toolbox",
  "test-toolbox": "the test toolbox",
  interface: "an interface",
};

const endedSaid: Readonly<Record<RoundsEnded, string>> = {
  leak: "a leak ended them",
  stopped: "the builder stopped",
  "no-findings": "the reviewer had no findings",
  "last-round": "no more may run",
};

const watchedPaths: readonly { readonly matches: RegExp; readonly says: string }[] = [
  { matches: /^components\/base\/[^/]+\/mode\.yaml$/, says: "base mode manifest changed, its list needs no trust" },
  { matches: /^bay\//, says: "kernel file changed" },
  { matches: /^adapters\//, says: "adapter file changed" },
  { matches: /^schemas\//, says: "kit schema changed" },
];

const checksPassed = /^Every check passed \(([^()]+)\), and so did the test run: (\d+) tests?\.$/;

const checkName = /^[A-Za-z0-9:._-]+$/;

const heldSaid: Readonly<Record<Proof["kind"], string>> = {
  checks: "checks",
  "fails-first": "a test fails first",
  "bugs-caught": "bugs caught",
  "same-output": "same output",
  count: "a count",
  "real-thing": "the real thing",
};

const plannedKinds: readonly Proof["kind"][] = [
  "checks",
  "fails-first",
  "bugs-caught",
  "same-output",
  "count",
  "real-thing",
];

const cardWidth = 44;

const computedRoom = cardWidth - "    ".length;

const judgedRoom = cardWidth - "judged     ".length;

const casesNamed = 3;

const longestShown = 120;

const mostDecisions = 3;

const unsafe = /[\p{Cc}\p{Cf}]/gu;

const sliceKinds: readonly Slice["kind"][] = ["interface", "capability", "mode"];

const lacking: readonly Missing["lacks"][] = ["kernel", "toolbox", "test-toolbox", "interface"];

function textOf(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function isEntries(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function entriesOf(value: Json | undefined): readonly Json[] {
  return isEntries(value) ? value : [];
}

function oneOf<Name extends string>(names: readonly Name[], value: Json | undefined): Name | undefined {
  return names.find((name) => name === value);
}

function textsOf(value: Json | undefined): readonly string[] {
  return entriesOf(value).map(textOf);
}

function numberOf(value: Json | undefined): number {
  return typeof value === "number" ? value : 0;
}

function safeText(text: string): string {
  const words = text
    .replace(unsafe, " ")
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");
  const characters = Array.from(words);
  return characters.length <= longestShown ? words : `${characters.slice(0, longestShown).join("")}...`;
}

function countOf(fields: JsonFields): Proof {
  if (typeof fields.use === "string") {
    return { kind: "count", use: fields.use };
  }
  const counted = { kind: "count", pattern: textOf(fields.pattern), paths: textsOf(fields.paths) } as const;
  return typeof fields.most === "number" ? { ...counted, most: fields.most } : { ...counted, noRise: true };
}

function proofOf(value: Json | undefined): Proof | undefined {
  const fields = fieldsOf(value ?? null);
  const kind = oneOf(plannedKinds, fields.kind);
  switch (kind) {
    case undefined:
      return undefined;
    case "checks":
    case "bugs-caught":
      return { kind };
    case "fails-first":
      return { kind, tests: textsOf(fields.tests) };
    case "same-output":
      return { kind, differ: textsOf(fields.differ) };
    case "count":
      return countOf(fields);
    case "real-thing":
      return { kind, runs: entriesOf(fields.runs).map((run) => ({ bay: textsOf(fieldsOf(run).bay) })) };
  }
}

function itemOf(value: Json): Item {
  const fields = fieldsOf(value);
  const level: Level = fields.level === "should" ? "should" : "must";
  const item = { id: textOf(fields.id), says: textOf(fields.says), level };
  const proof = proofOf(fields.proof);
  return proof === undefined ? item : { ...item, proof };
}

export function sliceOf(value: Json | undefined): Slice {
  const fields = fieldsOf(value ?? null);
  return {
    name: textOf(fields.name),
    kind: oneOf(sliceKinds, fields.kind) ?? "mode",
    scope: entriesOf(fields.scope).map(textOf),
    after: entriesOf(fields.after).map((after) => ({
      slice: textOf(fieldsOf(after).slice),
      because: textOf(fieldsOf(after).because),
    })),
    done: entriesOf(fields.done).map(itemOf),
  };
}

function failingNamesOf(value: Json | undefined): FailingNames {
  const fields = fieldsOf(value ?? null);
  const names = entriesOf(fields.failures).map((failure) => safeText(textOf(fieldsOf(failure).name)));
  return {
    names: [...new Set(names)].filter((name) => name !== ""),
    notListed: numberOf(fields.failuresNotListed),
    notLoaded: entriesOf(fields.notLoaded).length,
  };
}

function verdictOf(value: Json): Verdict {
  const fields = fieldsOf(value);
  const item = textOf(fields.item);
  const kind = oneOf(proofKinds, fields.kind) ?? "checks";
  const verdict = oneOf(["passed", "failed"], fields.verdict);
  if (verdict === undefined) {
    return { item, kind, verdict: "inconclusive", reason: textOf(fields.reason) };
  }
  const detail = textOf(fields.detail);
  if (verdict === "passed" || fields.cases === undefined) {
    return { item, kind, verdict, detail };
  }
  return { item, kind, verdict, detail, cases: failingNamesOf(fields.cases) };
}

function sizedOf(value: Json): Sized {
  const fields = fieldsOf(value);
  const lines = (key: "base" | "head"): Partial<Record<"base" | "head", number>> => {
    const counted = fields[key];
    return typeof counted === "number" ? { [key]: counted } : {};
  };
  return { path: textOf(fields.path), ...lines("base"), ...lines("head") };
}

export function provedOf(value: Json | undefined): Proved {
  const fields = fieldsOf(value ?? null);
  return {
    verdicts: entriesOf(fields.verdicts).map(verdictOf),
    size: entriesOf(fields.size).map(sizedOf),
  };
}

function decidedOf(value: Json | undefined): Decided {
  const decisions = textsOf(value)
    .map(safeText)
    .filter((decision) => decision !== "")
    .slice(0, mostDecisions);
  return decisions.length === 0 ? {} : { decisions };
}

export function builtOf(value: Json | undefined): Built {
  const fields = fieldsOf(value ?? null);
  const decided = decidedOf(fields.decisions);
  if (fields.outcome === "built") {
    return { outcome: "built", ...decided };
  }
  const missing = fieldsOf(fields.missing ?? null);
  return {
    outcome: "stopped",
    missing: { lacks: oneOf(lacking, missing.lacks) ?? "kernel", name: textOf(missing.name) },
    ...decided,
  };
}

export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ",");
}

function joined(names: readonly string[]): string {
  if (names.length < 2) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function piecesOf(word: string, room: number): readonly string[] {
  const pieces: string[] = [];
  let left = Array.from(word);
  while (left.length > room) {
    const slash = left.lastIndexOf("/", room - 1);
    const cut = slash > 0 ? slash + 1 : room;
    pieces.push(left.slice(0, cut).join(""));
    left = left.slice(cut);
  }
  return [...pieces, left.join("")];
}

function fitted(text: string, room: number): string {
  return text
    .replace(unsafe, " ")
    .split(" ")
    .filter((word) => word !== "")
    .flatMap((word) => piecesOf(word, room))
    .join(" ");
}

function computed(step: "slice" | "prove" | "draw", words: string): CardLine {
  return { mark: "computed", words: fitted(words, computedRoom), source: { step } };
}

function judged(step: string, words: string): CardLine {
  return { mark: "judged", words: fitted(words, judgedRoom), source: { step } };
}

function scopeWords(scope: readonly string[]): string {
  const [first = "", ...rest] = scope;
  return rest.length === 0 ? `scope: ${first}` : `scope: ${first} and ${counted(rest.length, "more path")}`;
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

function asksForBugs(slice: Slice): boolean {
  return slice.done.some((item) => item.proof?.kind === "bugs-caught");
}

function bugsWords(slice: Slice, bugs: readonly string[]): readonly string[] {
  const named = bugs.length === 0 ? [] : [`${counted(bugs.length, "bug")} to inject: ${bugs.join("; ")}`];
  if (!asksForBugs(slice)) {
    return bugs.length === 0 ? ["bugs: none will be planted"] : named;
  }
  if (bugs.length === 0) {
    return ["bugs: none named, so the planter writes them after the last round"];
  }
  return [...named, "the planter writes more after the last round"];
}

export function startCard(input: StartCardInput): StartCard {
  const { slice, title, base, bugs } = input;
  const afters = slice.after.map((after) => `after ${after.slice}: ${after.because}`);
  const words = [
    title,
    `kind ${slice.kind}; base ${base}`,
    scopeWords(slice.scope),
    ...(afters.length === 0 ? ["after no other slice"] : afters),
    ...slice.done.flatMap(itemWords),
    ...bugsWords(slice, bugs),
  ];
  return { title: `Build slice ${slice.name}?`, lines: words.map((said) => computed("slice", said)) };
}

function knownSaid(known: readonly Known[], sentence: string): string | undefined {
  for (const each of known) {
    const found = each.matches.exec(sentence);
    if (found !== null) {
      return each.says(found);
    }
  }
  return undefined;
}

function failedReason(kind: ProofKind, detail: string): string {
  const said = detail.split(/(?<=\.) /).map((sentence) => knownSaid(failedSentences, sentence));
  const known = said.filter((words) => words !== undefined);
  return known.length === said.length && known.length > 0 ? known.join("; ") : failedSaid[kind];
}

function checksWords(verdict: Verdict): readonly string[] {
  const found = verdict.verdict === "passed" ? checksPassed.exec(verdict.detail) : null;
  const names = found?.[1]?.split(", ") ?? [];
  const tests = found?.[2];
  if (tests === undefined || !names.every((name) => checkName.test(name))) {
    return [];
  }
  return [`checks passed: ${names.join(", ")}`, `tests passed: ${grouped(Number(tests))}`];
}

function caseWords(cases: FailingNames | undefined): readonly string[] {
  if (cases === undefined) {
    return [];
  }
  const named = cases.names.slice(0, casesNamed).map((name) => `failing: ${name}`);
  const more = cases.names.length - named.length + cases.notListed;
  const rest = more === 0 ? [] : [`and ${counted(more, "more failing case")}`];
  const notLoaded = cases.notLoaded === 0 ? [] : [`${counted(cases.notLoaded, "test file")} did not load`];
  return [...named, ...rest, ...notLoaded];
}

function verdictWords(verdict: Verdict): readonly string[] {
  switch (verdict.verdict) {
    case "passed":
      return checksWords(verdict);
    case "failed":
      return [`why: ${failedReason(verdict.kind, verdict.detail)}`, ...caseWords(verdict.cases)];
    case "inconclusive":
      return [`why: ${knownSaid(notKnownStarts, verdict.reason) ?? notKnownSaid}`];
  }
}

const verdictSaid: Readonly<Record<Verdict["verdict"], string>> = {
  passed: "passed",
  failed: "failed",
  inconclusive: "not known",
};

function shownItems(slice: Slice, verdicts: readonly Verdict[]): readonly ShownItem[] {
  const planned = slice.done.map((item) => ({ ...item, judgement: item.proof === undefined }));
  const added = verdicts
    .filter((verdict) => !slice.done.some((item) => item.id === verdict.item))
    .map((verdict) => ({ id: verdict.item, level: "must" as const, says: addedSays[verdict.item] ?? "" }));
  return [...planned, ...added.map((item) => ({ ...item, judgement: false }))];
}

function openingWords(item: ShownItem, said: string): string {
  const opening = `${item.id}, ${item.level}, ${said}`;
  return item.says === "" ? opening : `${opening}: ${item.says}`;
}

function itemLines(item: ShownItem, verdicts: readonly Verdict[]): readonly CardLine[] {
  const verdict = verdicts.find((each) => each.item === item.id);
  if (verdict === undefined && item.judgement) {
    return [computed("draw", openingWords(item, "for you to judge"))];
  }
  if (verdict === undefined) {
    return [computed("prove", openingWords(item, "not known")), computed("prove", `why: ${noVerdictSaid}`)];
  }
  const said = [openingWords(item, verdictSaid[verdict.verdict]), ...verdictWords(verdict)];
  return said.map((words) => computed("prove", words));
}

function verdictLines(slice: Slice, verdicts: readonly Verdict[]): readonly CardLine[] {
  return shownItems(slice, verdicts).flatMap((item) => itemLines(item, verdicts));
}

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
  const ran = `rounds: ${String(rounds.count)} of at most ${String(rounds.most)}; ${endedSaid[rounds.ended]}`;
  const { judged: lines } = rounds;
  const sentences = lines === undefined ? [] : lines.sentences.map((words) => judged(lines.step, words));
  return [computed("draw", ran), ...sentences];
}

function builderLines(built: Built, step: string): readonly CardLine[] {
  const stopped =
    built.outcome === "stopped"
      ? [`the builder stopped, saying ${lacksSaid[built.missing.lacks]} lacks ${built.missing.name}`]
      : [];
  const decided = (built.decisions ?? []).map((decision) => `the builder decided: ${decision}`);
  return [...stopped, ...decided].map((words) => judged(step, words));
}

function bugWords(bugs: BugsOnCard | undefined): readonly string[] {
  if (bugs === undefined) {
    return [];
  }
  const planted = bugs.planted === 0 ? [] : [`the planter wrote ${counted(bugs.planted, "bug")}`];
  return [...planted, ...bugs.survived.map((bug) => `bug survived: ${bug.name}, in ${joined(bug.files)}`)];
}

function leakWords(leak: Leak): string {
  switch (leak.kind) {
    case "shared-text":
      return `leak: ${leak.path} shares ${counted(leak.lines, "line")} with the tests`;
    case "mark":
      return `leak: ${leak.path} holds the mark planted in the tests`;
    case "mark-in-answer":
      return "leak: the builder's answer holds the mark planted in the tests";
  }
}

function answerWords(reason: string | undefined): string {
  return reason === undefined
    ? "Merge is offered: every must item, scope and declared passed."
    : `Merge is not offered: ${reason}`;
}

function drawnLines(input: MergeCardInput, reason: string | undefined): readonly CardLine[] {
  const { slice, proof, work, kept } = input;
  const drawnWords = [changedWords(proof.size, work, kept), ...sizeWords(proof.size), ...watchedWords(proof.size)];
  return [
    computed("draw", answerWords(reason)),
    ...(input.leaks ?? []).map((leak) => computed("draw", leakWords(leak))),
    ...verdictLines(slice, proof.verdicts),
    ...[...drawnWords, ...bugWords(input.bugs)].map((said) => computed("draw", said)),
    ...roundLines(input.rounds),
    ...builderLines(input.built, input.builtAt),
  ];
}

function levelOf(slice: Slice, id: string): Level {
  return slice.done.find((item) => item.id === id)?.level ?? "must";
}

function withoutVerdict(slice: Slice, verdicts: readonly Verdict[]): readonly string[] {
  return slice.done
    .filter((item) => item.proof !== undefined && !verdicts.some((verdict) => verdict.item === item.id))
    .map((item) => item.id);
}

function unmetMust(slice: Slice, verdicts: readonly Verdict[]): Unmet {
  const must = verdicts.filter((verdict) => levelOf(slice, verdict.item) === "must");
  return {
    failed: must.filter((verdict) => verdict.verdict === "failed").map((verdict) => verdict.item),
    notKnown: [
      ...must.filter((verdict) => verdict.verdict === "inconclusive").map((verdict) => verdict.item),
      ...withoutVerdict(slice, verdicts).filter((id) => levelOf(slice, id) === "must"),
    ],
  };
}

function unmetClause(ids: readonly string[], verb: { readonly one: string; readonly many: string }): string[] {
  const added = Object.keys(addedSays);
  const items = ids.filter((id) => !added.includes(id)).length;
  const named = ids.filter((id) => added.includes(id));
  const parts = [...(items === 0 ? [] : [counted(items, "must item")]), ...named];
  if (parts.length === 0) {
    return [];
  }
  return [`${joined(parts)} ${items > 1 || parts.length > 1 ? verb.many : verb.one}`];
}

function mergeReason(input: MergeCardInput): string | undefined {
  const unmet = unmetMust(input.slice, input.proof.verdicts);
  const clauses = [
    ...(input.built.outcome === "stopped" ? ["the builder stopped"] : []),
    ...((input.leaks ?? []).length === 0 ? [] : ["the builder's work holds text from the tests"]),
    ...unmetClause(unmet.failed, { one: "failed", many: "failed" }),
    ...unmetClause(unmet.notKnown, { one: "is not known", many: "are not known" }),
  ];
  return clauses.length === 0 ? undefined : `${clauses.join("; ")}.`;
}

function sentenceOf(clause: string): string {
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
}

export function drawn(input: MergeCardInput): Drawn {
  const reason = mergeReason(input);
  const withheld = { "send-back": sendBackReason, discard: discardReason };
  return {
    card: {
      title: `Merge ${input.slice.name} into ${input.into}?`,
      lines: drawnLines(input, reason),
      withheld: reason === undefined ? withheld : { merge: sentenceOf(reason), ...withheld },
    },
    merge: reason === undefined,
    sendBack: false,
    discard: false,
  };
}
