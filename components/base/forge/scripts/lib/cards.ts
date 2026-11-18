import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";

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

export type Item = {
  readonly id: string;
  readonly says: string;
  readonly level: Level;
  readonly proof?: { readonly kind: ProofKind };
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

export type Verdict =
  | { readonly item: string; readonly kind: ProofKind; readonly verdict: "passed" | "failed"; readonly detail: string }
  | { readonly item: string; readonly kind: ProofKind; readonly verdict: "inconclusive"; readonly reason: string };

export type Judged = {
  readonly id: string;
  readonly says: string;
  readonly level: Level;
};

export type Sized = {
  readonly path: string;
  readonly base?: number;
  readonly head?: number;
};

export type Proved = {
  readonly verdicts: readonly Verdict[];
  readonly judgement: readonly Judged[];
  readonly size: readonly Sized[];
};

export type Missing = {
  readonly lacks: "kernel" | "toolbox" | "test-toolbox" | "interface";
  readonly name: string;
};

export type Built = { readonly outcome: "built" } | { readonly outcome: "stopped"; readonly missing: Missing };

export type CardLine = {
  readonly mark: "computed";
  readonly words: string;
  readonly source: { readonly step: "slice" | "prove" | "draw" };
};

export type StartCardInput = {
  readonly slice: Slice;
  readonly title: string;
  readonly base: string;
};

export type StartCard = {
  readonly title: string;
  readonly lines: readonly CardLine[];
};

export type MergeCardInput = {
  readonly slice: Slice;
  readonly proof: Proved;
  readonly built: Built;
  readonly work: string;
  readonly into: string;
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

const addedItems = ["scope", "declared"];

const sendBackReason = "rounds come with slice F2.";

const discardReason = "discarding comes with slice WD1.";

const passedSaid: Readonly<Record<ProofKind, string>> = {
  checks: "the checks and the tests pass",
  "fails-first": "the named tests failed on the base and pass on the head",
  "in-scope": "every changed path is in the write scope",
  "as-declared": "what changed is as declared",
  "bugs-caught": "every injected bug was caught",
  "same-output": "the output is the same",
  count: "each count holds",
  "real-thing": "the runs printed what was expected",
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

const checksPassed = /^Every check passed \(([^()]+)\), and so did the test run: (\d+) tests?\.$/;

const checkName = /^[A-Za-z0-9:._-]+$/;

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

function itemOf(value: Json): Item {
  const fields = fieldsOf(value);
  const level: Level = fields.level === "should" ? "should" : "must";
  const item = { id: textOf(fields.id), says: textOf(fields.says), level };
  const kind = oneOf(proofKinds, fieldsOf(fields.proof ?? null).kind);
  return kind === undefined ? item : { ...item, proof: { kind } };
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

function verdictOf(value: Json): Verdict {
  const fields = fieldsOf(value);
  const item = textOf(fields.item);
  const kind = oneOf(proofKinds, fields.kind) ?? "checks";
  const verdict = oneOf(["passed", "failed"], fields.verdict);
  return verdict === undefined
    ? { item, kind, verdict: "inconclusive", reason: textOf(fields.reason) }
    : { item, kind, verdict, detail: textOf(fields.detail) };
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
    judgement: entriesOf(fields.judgement).map(itemOf),
    size: entriesOf(fields.size).map(sizedOf),
  };
}

export function builtOf(value: Json | undefined): Built {
  const fields = fieldsOf(value ?? null);
  if (fields.outcome === "built") {
    return { outcome: "built" };
  }
  const missing = fieldsOf(fields.missing ?? null);
  return {
    outcome: "stopped",
    missing: { lacks: oneOf(lacking, missing.lacks) ?? "kernel", name: textOf(missing.name) },
  };
}

function counted(count: number, noun: string): string {
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

function computed(step: CardLine["source"]["step"], words: string): CardLine {
  return { mark: "computed", words, source: { step } };
}

function itemPrefix(slice: Slice): string {
  return `DOD-${slice.name}-`;
}

function shortIds(slice: Slice, ids: readonly string[]): string {
  const prefix = itemPrefix(slice);
  const firstWithPrefix = ids.findIndex((id) => id.startsWith(prefix));
  return ids
    .map((id, at) =>
      at > firstWithPrefix && firstWithPrefix >= 0 && id.startsWith(prefix) ? id.slice(prefix.length) : id,
    )
    .join(", ");
}

function scopeWords(scope: readonly string[]): string {
  const [first = "", ...rest] = scope;
  return rest.length === 0 ? `scope: ${first}` : `scope: ${first} and ${counted(rest.length, "more path")}`;
}

function itemsWords(done: readonly Item[]): string {
  const proved = done.filter((item) => item.proof !== undefined).length;
  const judged = done.length - proved;
  return (
    `${counted(done.length, "item")}: ` +
    `${String(proved)} ${proved === 1 ? "names" : "name"} a kind of proof, ` +
    `${String(judged)} ${judged === 1 ? "is" : "are"} judgement`
  );
}

function judgementWords(slice: Slice): readonly string[] {
  const prefix = itemPrefix(slice);
  const judged = slice.done.filter((item) => item.proof === undefined);
  if (judged.length === 0) {
    return [];
  }
  const ids = judged.map((item) => (item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id));
  return [`judgement, by you: ${ids.join(", ")}`];
}

export function startCard(input: StartCardInput): StartCard {
  const { slice, title, base } = input;
  const afters = slice.after.map((after) => `after ${after.slice}: ${after.because}`);
  const words = [
    title,
    `kind ${slice.kind}; base ${base}`,
    scopeWords(slice.scope),
    ...(afters.length === 0 ? ["after no other slice"] : afters),
    itemsWords(slice.done),
    ...judgementWords(slice),
  ];
  return { title: `Build slice ${slice.name}?`, lines: words.map((said) => computed("slice", said)) };
}

function isNotBuilt(verdict: Verdict): boolean {
  return (
    verdict.verdict === "inconclusive" &&
    verdict.reason === `The kind ${verdict.kind} is not built in this version of the proof mode, so nothing is known.`
  );
}

function checksWords(verdict: Verdict): readonly string[] | undefined {
  const found = verdict.verdict === "passed" ? checksPassed.exec(verdict.detail) : null;
  const names = found?.[1]?.split(", ") ?? [];
  const tests = found?.[2];
  if (tests === undefined || !names.every((name) => checkName.test(name))) {
    return undefined;
  }
  return [`checks passed: ${names.join(", ")}`, `tests passed: ${grouped(Number(tests))}`];
}

function passedWords(slice: Slice, verdicts: readonly Verdict[]): readonly string[] {
  const passed = verdicts.filter((verdict) => verdict.verdict === "passed");
  return proofKinds.flatMap((kind) => {
    const ofKind = passed.filter((verdict) => verdict.kind === kind);
    const told = kind === "checks" ? ofKind.map(checksWords) : [];
    const said = told.flatMap((words) => words ?? []);
    const plain = ofKind.filter((_, at) => told[at] === undefined).map((verdict) => verdict.item);
    return plain.length === 0 ? said : [...said, `${shortIds(slice, plain)}: ${passedSaid[kind]}`];
  });
}

function failedWords(slice: Slice, verdicts: readonly Verdict[]): readonly string[] {
  return proofKinds.flatMap((kind) => {
    const ids = verdicts.filter((verdict) => verdict.verdict === "failed" && verdict.kind === kind);
    return ids.length === 0
      ? []
      : [
          `failed, kind ${kind}: ${shortIds(
            slice,
            ids.map((verdict) => verdict.item),
          )}`,
        ];
  });
}

function withoutVerdict(slice: Slice, verdicts: readonly Verdict[]): readonly string[] {
  return slice.done
    .filter((item) => item.proof !== undefined && !verdicts.some((verdict) => verdict.item === item.id))
    .map((item) => item.id);
}

function notKnownWords(slice: Slice, verdicts: readonly Verdict[]): readonly string[] {
  const inconclusive = verdicts.filter((verdict) => verdict.verdict === "inconclusive");
  const groups = [
    { said: "not known, kind not built", ids: inconclusive.filter(isNotBuilt).map((verdict) => verdict.item) },
    {
      said: "not known",
      ids: inconclusive.filter((verdict) => !isNotBuilt(verdict)).map((verdict) => verdict.item),
    },
    { said: "not known, no verdict", ids: withoutVerdict(slice, verdicts) },
  ];
  return groups.flatMap((group) => (group.ids.length === 0 ? [] : [`${group.said}: ${shortIds(slice, group.ids)}`]));
}

function verdictLines(slice: Slice, verdicts: readonly Verdict[]): readonly CardLine[] {
  const words = [...passedWords(slice, verdicts), ...failedWords(slice, verdicts), ...notKnownWords(slice, verdicts)];
  return words.map((said) => computed("prove", said));
}

function builtWords(built: Built): readonly string[] {
  switch (built.outcome) {
    case "built":
      return [];
    case "stopped":
      return [`the builder stopped: ${lacksSaid[built.missing.lacks]} lacks ${built.missing.name}`];
  }
}

function changedWords(size: readonly Sized[], work: string): string {
  const changed = size.length === 0 ? "what changed is not known" : `${counted(size.length, "file")} changed`;
  return `${changed}; the work is set aside on ${work}`;
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

function drawnLines(input: MergeCardInput): readonly CardLine[] {
  const { slice, proof, built, work } = input;
  const judged = proof.judgement.map((item) => `not judged, for you: ${item.id} ${item.says}`);
  return [
    ...builtWords(built).map((said) => computed("draw", said)),
    computed("draw", changedWords(proof.size, work)),
    ...verdictLines(slice, proof.verdicts),
    ...[...judged, ...sizeWords(proof.size), ...watchedWords(proof.size)].map((said) => computed("draw", said)),
  ];
}

function levelOf(slice: Slice, id: string): Level {
  return slice.done.find((item) => item.id === id)?.level ?? "must";
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
  const items = ids.filter((id) => !addedItems.includes(id)).length;
  const named = ids.filter((id) => addedItems.includes(id));
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
    ...unmetClause(unmet.failed, { one: "failed", many: "failed" }),
    ...unmetClause(unmet.notKnown, { one: "is not known", many: "are not known" }),
  ];
  return clauses.length === 0 ? undefined : `${clauses.join("; ")}.`;
}

export function drawn(input: MergeCardInput): Drawn {
  const reason = mergeReason(input);
  const withheld = { "send-back": sendBackReason, discard: discardReason };
  return {
    card: {
      title: `Merge ${input.slice.name} into ${input.into}?`,
      lines: drawnLines(input),
      withheld: reason === undefined ? withheld : { merge: reason, ...withheld },
    },
    merge: reason === undefined,
    sendBack: false,
    discard: false,
  };
}
