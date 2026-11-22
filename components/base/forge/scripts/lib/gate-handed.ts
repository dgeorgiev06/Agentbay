import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { gateFrom, gateOf, gatedOf, type Gate } from "./gate.ts";
import { gateDiffers } from "./gate-words.ts";
import { listOf } from "./json-values.ts";

type WorkedOut = {
  readonly gate: Gate;
  readonly differs?: string;
};

export function gateWorkedOut(fields: JsonFields): WorkedOut {
  const handed = gateFrom(fields.gate);
  const gate = gateOf(gatedOf(fields.gatedBy));
  return JSON.stringify(handed) === JSON.stringify(gate) ? { gate } : { gate, differs: gateDiffers(handed, gate) };
}

export function withDifferenceFailed(proof: Json, differs: string | undefined): Json {
  if (differs === undefined) {
    return proof;
  }
  const fields = fieldsOf(proof);
  const failed = (verdict: Json): Json => {
    const { item = null, kind = null } = fieldsOf(verdict);
    return { item, kind, verdict: "failed", detail: differs };
  };
  const verdicts = listOf(fields.verdicts).map((verdict) =>
    fieldsOf(verdict).kind === "checks" ? failed(verdict) : verdict,
  );
  return { ...fields, verdicts };
}
