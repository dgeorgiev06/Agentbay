import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { listOf, oneOf, textOf } from "./json-values.ts";

export const proofKinds = [
  "checks",
  "fails-first",
  "in-scope",
  "as-declared",
  "bugs-caught",
  "same-output",
  "count",
  "real-thing",
  "printed",
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

type After = {
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

const plannedKinds: readonly Proof["kind"][] = [
  "checks",
  "fails-first",
  "bugs-caught",
  "same-output",
  "count",
  "real-thing",
];

const sliceKinds: readonly Slice["kind"][] = ["interface", "capability", "mode"];

function textsOf(value: Json | undefined): readonly string[] {
  return listOf(value).map(textOf);
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
      return { kind, runs: listOf(fields.runs).map((run) => ({ bay: textsOf(fieldsOf(run).bay) })) };
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
    scope: textsOf(fields.scope),
    after: listOf(fields.after).map((after) => ({
      slice: textOf(fieldsOf(after).slice),
      because: textOf(fieldsOf(after).because),
    })),
    done: listOf(fields.done).map(itemOf),
  };
}
