import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { safeText } from "./card-lines.ts";
import { listOf, oneOf, textOf } from "./json-values.ts";

export type Missing = {
  readonly lacks: "kernel" | "toolbox" | "test-toolbox" | "interface";
  readonly name: string;
};

type Decided = {
  readonly decisions?: readonly string[];
};

export type Built = ({ readonly outcome: "built" } | { readonly outcome: "stopped"; readonly missing: Missing }) &
  Decided;

const mostDecisions = 3;

const lacking: readonly Missing["lacks"][] = ["kernel", "toolbox", "test-toolbox", "interface"];

function decidedOf(value: Json | undefined): Decided {
  const decisions = listOf(value)
    .map(textOf)
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
