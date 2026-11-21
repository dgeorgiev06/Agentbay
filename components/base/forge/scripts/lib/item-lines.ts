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
  { matches: /^No copy of [0-9a-f]+ could be made:/, says: () => "no copy of the commit could be made" },
];

const notKnownSaid = "proof could not tell, so nothing is known";

const noVerdictSaid = "proof gave no verdict";

const checksPassed = /^Every check passed \(([^()]+)\), and so did the test run: (\d+) tests?\.$/;

const checkName = /^[A-Za-z0-9:._-]+$/;

const casesNamed = 3;

const longestReason = 240;

export type CaseMessages = "filtered" | "unfiltered";

export type ItemsShown = {
  readonly messages: CaseMessages;
  readonly provedBy: ComputedBy;
};

const verdictSaid: Readonly<Record<Verdict["verdict"], string>> = {
  passed: "passed",
  failed: "failed",
  inconclusive: "not known",
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

function checksWords(verdict: Verdict): readonly string[] {
  const found = verdict.verdict === "passed" ? checksPassed.exec(verdict.detail) : null;
  const names = found?.[1]?.split(", ") ?? [];
  const tests = found?.[2];
  if (tests === undefined || !names.every((name) => checkName.test(name))) {
    return [];
  }
  return [`checks passed: ${names.join(", ")}`, `tests passed: ${grouped(Number(tests))}`];
}

function namedCaseWords(failing: FailingCase, messages: CaseMessages): readonly string[] {
  const named = `failing: ${failing.name}`;
  return messages === "filtered" && failing.message !== "" ? [named, `its message: ${failing.message}`] : [named];
}

function caseWords(cases: FailingCases | undefined, messages: CaseMessages): readonly string[] {
  if (cases === undefined) {
    return [];
  }
  const shown = cases.cases.slice(0, casesNamed);
  const named = shown.flatMap((failing) => namedCaseWords(failing, messages));
  const more = cases.cases.length - shown.length + cases.notListed;
  const rest = more === 0 ? [] : [`and ${counted(more, "more failing case")}`];
  const notLoaded = cases.notLoaded === 0 ? [] : [`${counted(cases.notLoaded, "test file")} did not load`];
  return [...named, ...rest, ...notLoaded];
}

function proofsWords(said: string): readonly string[] {
  const reason = shortened(said, longestReason);
  return reason === "" ? [] : [`proof's reason: ${reason}`];
}

function verdictWords(verdict: Verdict, messages: CaseMessages): readonly string[] {
  switch (verdict.verdict) {
    case "passed":
      return checksWords(verdict);
    case "failed":
      return [
        `why: ${failedReason(verdict.kind, verdict.detail)}`,
        ...proofsWords(verdict.detail),
        ...caseWords(verdict.cases, messages),
      ];
    case "inconclusive":
      return [`why: ${knownSaid(notKnownStarts, verdict.reason) ?? notKnownSaid}`, ...proofsWords(verdict.reason)];
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

function openingWords(item: ShownItem, said: string): string {
  const opening = `${item.id}, ${item.level}, ${said}`;
  return item.says === "" ? opening : `${opening}: ${item.says}`;
}

function itemLines(item: ShownItem, verdicts: readonly Verdict[], shown: ItemsShown): readonly CardLine[] {
  const verdict = verdicts.find((each) => each.item === item.id);
  const { provedBy } = shown;
  if (verdict === undefined && item.judgement) {
    return [computed("draw", openingWords(item, "for you to judge"))];
  }
  if (verdict === undefined) {
    return [computed(provedBy, openingWords(item, "not known")), computed(provedBy, `why: ${noVerdictSaid}`)];
  }
  const said = [openingWords(item, verdictSaid[verdict.verdict]), ...verdictWords(verdict, shown.messages)];
  return said.map((words) => computed(provedBy, words));
}

export function verdictLines(slice: Slice, verdicts: readonly Verdict[], shown: ItemsShown): readonly CardLine[] {
  return shownItems(slice, verdicts).flatMap((item) => itemLines(item, verdicts, shown));
}
