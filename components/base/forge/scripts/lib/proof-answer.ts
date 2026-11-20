import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { safeText } from "./card-lines.ts";
import { listOf, numberOf, oneOf, textOf } from "./json-values.ts";
import { proofKinds, type ProofKind } from "./slice-form.ts";

export type FailingCase = {
  readonly name: string;
  readonly message: string;
};

export type FailingCases = {
  readonly cases: readonly FailingCase[];
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
      readonly cases?: FailingCases;
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

function failingCaseOf(value: Json): FailingCase {
  const fields = fieldsOf(value);
  return { name: safeText(textOf(fields.name)), message: safeText(textOf(fields.message)) };
}

function onceEach(cases: readonly FailingCase[]): readonly FailingCase[] {
  const names = cases.map((each) => each.name);
  return cases.filter((each, at) => each.name !== "" && names.indexOf(each.name) === at);
}

function failingCasesOf(value: Json | undefined): FailingCases {
  const fields = fieldsOf(value ?? null);
  return {
    cases: onceEach(listOf(fields.failures).map(failingCaseOf)),
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
  return { item, kind, verdict, detail, cases: failingCasesOf(fields.cases) };
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
