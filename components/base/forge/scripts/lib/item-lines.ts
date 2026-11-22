import { computed, counted, grouped, shortened, type CardLine, type ComputedBy } from "./card-lines.ts";
import type { FailingCase, FailingCases, Verdict } from "./proof-answer.ts";
import type { Level, ProofKind, Slice } from "./slice-form.ts";

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

export const addedIds: readonly string[] = Object.keys(addedSays);

const failedSaid: Readonly<Record<ProofKind, string>> = {
  checks: "a check or the test run failed",
  "fails-first": "the named tests do not fail first and pass after",
  "in-scope": "a changed path is outside the write scope",
  "as-declared": "what changed is not as declared",
  "bugs-caught": "an injected bug survived",
  "same-output": "the output is not as the item says",
  count: "a count does not hold",
  "real-thing": "a run printed other than expected",
  printed: "proof gives no failure for what a run printed",
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
  {
    matches: /^(\d+) tests? failed in the run of the (\d+) test files? chosen from testsFrom\.$/,
    says: (found) =>
      `${counted(Number(found[1]), "test")} failed, in ${counted(Number(found[2]), "test file")} chosen by the gate`,
  },
  {
    matches: /^bay check on the head found (\d+ errors?|errors)\.$/,
    says: (found) => `bay check on the head found ${found[1] ?? ""}`,
  },
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
  { matches: /^No bugs were given to inject,/, says: () => "no bugs were given to inject" },
  { matches: /^The toolchain ran no checks,/, says: () => "the toolchain ran no checks" },
  { matches: /^bay check on the head is not known:/, says: () => "bay check on the head is not known" },
  { matches: /^bay check on the head ended with exit code/, says: () => "bay check on the head ended otherwise" },
  { matches: /^No copy of [0-9a-f]+ could be made:/, says: () => "no copy of the commit could be made" },
];

const notKnownSaid = "proof could not tell, so nothing is known";

const noVerdictSaid = "proof gave no verdict";

const checksPassed =
  /^Every check passed \(([^()]+)\), and so did (?:the test run|the run of the (\d+) test files? chosen from testsFrom): (\d+) tests?\.( bay check on the head found no error\.)?$/;

const checkName = /^[A-Za-z0-9:._-]+$/;

const casesNamed = 3;

const longestReason = 240;

export type CaseMessages = "filtered" | "unfiltered";

export type ItemsShown = {
  readonly messages: CaseMessages;
  readonly provedBy: ComputedBy;
};

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

export type PassedCounts = {
  readonly checks: readonly string[];
  readonly tests: number;
  readonly files?: number;
  readonly bayCheck: boolean;
};

export type CasesSaid = {
  readonly named: readonly FailingCase[];
  readonly more: number;
  readonly notLoaded: number;
};

export type Said = "passed" | "failed" | "not known" | "for you to judge";

export type ItemSaid = {
  readonly id: string;
  readonly level: Level;
  readonly says: string;
  readonly added: boolean;
  readonly said: Said;
  readonly drawn: boolean;
  readonly passed?: PassedCounts;
  readonly why?: string;
  readonly reason?: string;
  readonly cases?: CasesSaid;
};

export function passedCounts(verdict: Verdict): PassedCounts | undefined {
  const found = verdict.verdict === "passed" ? checksPassed.exec(verdict.detail) : null;
  if (found === null) {
    return undefined;
  }
  const [, listed = "", files, tests = "", bay] = found;
  const checks = listed.split(", ");
  if (!checks.every((name) => checkName.test(name))) {
    return undefined;
  }
  const counts = { checks, tests: Number(tests), bayCheck: bay !== undefined };
  return files === undefined ? counts : { ...counts, files: Number(files) };
}

function testsPassedWords(counts: PassedCounts): string {
  const among = counts.files === undefined ? "" : `, in ${counted(counts.files, "test file")} chosen by the gate`;
  return `tests passed: ${grouped(counts.tests)}${among}`;
}

function passedWords(counts: PassedCounts | undefined): readonly string[] {
  if (counts === undefined) {
    return [];
  }
  const bayWords = counts.bayCheck ? ["bay check on the head found no error"] : [];
  return [`checks passed: ${counts.checks.join(", ")}`, ...bayWords, testsPassedWords(counts)];
}

function casesSaid(cases: FailingCases | undefined): CasesSaid | undefined {
  if (cases === undefined) {
    return undefined;
  }
  const named = cases.cases.slice(0, casesNamed);
  return { named, more: cases.cases.length - named.length + cases.notListed, notLoaded: cases.notLoaded };
}

function namedCaseWords(failing: FailingCase, messages: CaseMessages): readonly string[] {
  const named = `failing: ${failing.name}`;
  return messages === "filtered" && failing.message !== "" ? [named, `its message: ${failing.message}`] : [named];
}

function caseWords(cases: CasesSaid | undefined, messages: CaseMessages): readonly string[] {
  if (cases === undefined) {
    return [];
  }
  const named = cases.named.flatMap((failing) => namedCaseWords(failing, messages));
  const rest = cases.more === 0 ? [] : [`and ${counted(cases.more, "more failing case")}`];
  const notLoaded = cases.notLoaded === 0 ? [] : [`${counted(cases.notLoaded, "test file")} did not load`];
  return [...named, ...rest, ...notLoaded];
}

function proofsReason(said: string): { readonly reason?: string } {
  const reason = shortened(said, longestReason);
  return reason === "" ? {} : { reason };
}

function verdictSaid(verdict: Verdict): Omit<ItemSaid, keyof ShownItem | "added" | "drawn"> {
  switch (verdict.verdict) {
    case "passed": {
      const passed = passedCounts(verdict);
      return passed === undefined ? { said: "passed" } : { said: "passed", passed };
    }
    case "failed": {
      const cases = casesSaid(verdict.cases);
      const failed = { said: "failed" as const, why: failedReason(verdict.kind, verdict.detail) };
      return { ...failed, ...proofsReason(verdict.detail), ...(cases === undefined ? {} : { cases }) };
    }
    case "inconclusive": {
      const why = knownSaid(notKnownStarts, verdict.reason) ?? notKnownSaid;
      return { said: "not known", why, ...proofsReason(verdict.reason) };
    }
  }
}

function shownItems(slice: Slice, verdicts: readonly Verdict[]): readonly ShownItem[] {
  const planned = slice.done.map((item) => ({ ...item, judgement: item.proof === undefined }));
  const added = verdicts
    .filter((verdict) => !slice.done.some((item) => item.id === verdict.item))
    .map((verdict) => ({
      id: verdict.item,
      level: "must" as const,
      says: addedSays[verdict.item] ?? "",
      judgement: false,
    }));
  return [...planned, ...added];
}

function itemSaid(item: ShownItem, verdicts: readonly Verdict[], planned: boolean): ItemSaid {
  const verdict = verdicts.find((each) => each.item === item.id);
  const shown = { id: item.id, level: item.level, says: item.says, added: !planned };
  if (verdict === undefined && item.judgement) {
    return { ...shown, said: "for you to judge", drawn: true };
  }
  if (verdict === undefined) {
    return { ...shown, said: "not known", drawn: false, why: noVerdictSaid };
  }
  return { ...shown, drawn: false, ...verdictSaid(verdict) };
}

export function itemsSaid(slice: Slice, verdicts: readonly Verdict[]): readonly ItemSaid[] {
  const planned = slice.done.map((item) => item.id);
  return shownItems(slice, verdicts).map((item) => itemSaid(item, verdicts, planned.includes(item.id)));
}

function openingWords(item: ItemSaid): string {
  const opening = `${item.id}, ${item.level}, ${item.said}`;
  return item.says === "" ? opening : `${opening}: ${item.says}`;
}

function itemWords(item: ItemSaid, messages: CaseMessages): readonly string[] {
  return [
    openingWords(item),
    ...passedWords(item.passed),
    ...(item.why === undefined ? [] : [`why: ${item.why}`]),
    ...(item.reason === undefined ? [] : [`proof's reason: ${item.reason}`]),
    ...caseWords(item.cases, messages),
  ];
}

function itemLines(item: ItemSaid, shown: ItemsShown): readonly CardLine[] {
  const step = item.drawn ? "draw" : shown.provedBy;
  return itemWords(item, shown.messages).map((words) => computed(step, words));
}

function screenCaseWords(cases: CasesSaid | undefined): readonly string[] {
  if (cases === undefined) {
    return [];
  }
  const named = cases.named.flatMap((failing) => namedCaseWords(failing, "filtered"));
  const more = cases.more === 0 ? [] : [`${counted(cases.more, "more failing case")} not named here`];
  const notLoaded = cases.notLoaded === 0 ? [] : [`${counted(cases.notLoaded, "test file")} did not load`];
  return [...named, ...more, ...notLoaded];
}

const saidAsVerb: Readonly<Record<Said, string>> = {
  passed: "passed",
  failed: "failed",
  "not known": "is not known",
  "for you to judge": "is for you to judge",
};

export function itemOpening(item: ItemSaid): string {
  const opening = `the ${item.level} item ${item.id} ${saidAsVerb[item.said]}`;
  return item.added && item.says !== "" ? `${opening}: ${item.says}` : opening;
}

export function screenItemWords(item: ItemSaid): readonly string[] {
  return [
    itemOpening(item),
    ...passedWords(item.passed),
    ...(item.why === undefined ? [] : [`the reason: ${item.why}`]),
    ...(item.reason === undefined ? [] : [`proof's reason: ${item.reason}`]),
    ...screenCaseWords(item.cases),
  ];
}

export function verdictLines(slice: Slice, verdicts: readonly Verdict[], shown: ItemsShown): readonly CardLine[] {
  return itemsSaid(slice, verdicts).flatMap((item) => itemLines(item, shown));
}
