import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { safeText } from "./card-lines.ts";
import { listOf, numberOf, oneOf, textOf } from "./json-values.ts";
import { proofKinds, type ProofKind } from "./slice-form.ts";

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

function failingNamesOf(value: Json | undefined): FailingNames {
  const fields = fieldsOf(value ?? null);
  const names = listOf(fields.failures).map((failure) => safeText(textOf(fieldsOf(failure).name)));
  return {
    names: [...new Set(names)].filter((name) => name !== ""),
    notListed: numberOf(fields.failuresNotListed),
    notLoaded: listOf(fields.notLoaded).length,
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
    verdicts: listOf(fields.verdicts).map(verdictOf),
    size: listOf(fields.size).map(sizedOf),
  };
}
