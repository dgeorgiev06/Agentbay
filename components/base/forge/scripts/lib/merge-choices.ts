import type { Built } from "./builder-answer.ts";
import { counted, joined } from "./card-lines.ts";
import { interfaceClauses, type InterfaceChange } from "./interface-pins.ts";
import { addedIds } from "./item-lines.ts";
import { mustClause } from "./practices-block.ts";
import type { Verdict } from "./proof-answer.ts";
import type { Level, Slice } from "./slice-form.ts";

export type WithheldChoice = "merge" | "send-back" | "discard";

export type Standing = {
  readonly slice: Slice;
  readonly verdicts: readonly Verdict[];
  readonly built: Built;
  readonly leaked: boolean;
  readonly mustNotHeld: readonly string[];
  readonly interfaceChanges: readonly InterfaceChange[];
};

type Unmet = {
  readonly failed: readonly string[];
  readonly notKnown: readonly string[];
};

const sendBackReason = "No round runs after the card.";

const discardReason = "Discarding comes with slice WD1.";

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
  const items = ids.filter((id) => !addedIds.includes(id)).length;
  const named = ids.filter((id) => addedIds.includes(id));
  const parts = [...(items === 0 ? [] : [counted(items, "must item")]), ...named];
  if (parts.length === 0) {
    return [];
  }
  return [`${joined(parts)} ${items > 1 || parts.length > 1 ? verb.many : verb.one}`];
}

export function mergeReason(standing: Standing): string | undefined {
  const unmet = unmetMust(standing.slice, standing.verdicts);
  const clauses = [
    ...(standing.built.outcome === "stopped" ? ["the builder stopped"] : []),
    ...(standing.leaked ? ["the builder's work holds text from the tests"] : []),
    ...unmetClause(unmet.failed, { one: "failed", many: "failed" }),
    ...unmetClause(unmet.notKnown, { one: "is not known", many: "are not known" }),
    ...mustClause(standing.mustNotHeld),
    ...interfaceClauses(standing.interfaceChanges),
  ];
  return clauses.length === 0 ? undefined : `${clauses.join("; ")}.`;
}

export function answerWords(reason: string | undefined): string {
  return reason === undefined
    ? "Merge is offered: every must item that proof judged passed."
    : `Merge is not offered: ${reason}`;
}

export function sentenceOf(clause: string): string {
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`;
}

export function withheldReasons(reason: string | undefined): Partial<Record<WithheldChoice, string>> {
  const withheld = { "send-back": sendBackReason, discard: discardReason };
  return reason === undefined ? withheld : { merge: sentenceOf(reason), ...withheld };
}
