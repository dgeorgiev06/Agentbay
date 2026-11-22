import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import type { Gate } from "./gate.ts";
import { modeChecksSays } from "./gate-words.ts";
import { listOf, textOf } from "./json-values.ts";

const says =
  "Added by forge, as the plan lists no checks item: the toolchain's checks, such as types, lint, format and " +
  "dead code, and its whole test run pass.";

function isChecks(item: Json): boolean {
  return fieldsOf(fieldsOf(item).proof ?? null).kind === "checks";
}

function freeId(done: readonly Json[]): string {
  return done.some((item) => fieldsOf(item).id === "checks") ? "forge-checks" : "checks";
}

export function onlyChecks(slice: Json): Json {
  const fields = fieldsOf(slice);
  return { ...fields, done: listOf(fields.done).filter(isChecks) };
}

export function withoutChecks(slice: Json): Json {
  const fields = fieldsOf(slice);
  return { ...fields, done: listOf(fields.done).filter((item) => !isChecks(item)) };
}

export function withToolChecks(slice: Json): Json {
  const fields = fieldsOf(slice);
  const done = listOf(fields.done);
  if (done.some(isChecks)) {
    return slice;
  }
  const added = { id: freeId(done), says, level: "must", proof: { kind: "checks" } };
  return { ...fields, done: [...done, added] };
}

function withChecksItems(slice: Json, changed: (item: JsonFields) => JsonFields): Json {
  const fields = fieldsOf(slice);
  const done = listOf(fields.done).map((item) => (isChecks(item) ? changed(fieldsOf(item)) : item));
  return { ...fields, done };
}

export function withGateSaid(slice: Json, gate: Gate): Json {
  if (gate.gate === "whole") {
    return slice;
  }
  return withChecksItems(slice, (item) => ({ ...item, says: modeChecksSays(gate) }));
}

const gatedFields = ["testsFrom", "bayCheck"];

export function withGatedRuns(slice: Json, testsFrom: readonly string[]): Json {
  const proof = { kind: "checks", testsFrom: [...testsFrom], bayCheck: true };
  return withChecksItems(slice, (item) => ({ ...item, proof }));
}

export function withoutGatedRuns(slice: Json): Json {
  return withChecksItems(slice, (item) => ({ ...item, proof: { kind: "checks" } }));
}

function namesAGatedField(item: Json): boolean {
  const proof = fieldsOf(fieldsOf(item).proof ?? null);
  return gatedFields.some((field) => field in proof);
}

export function gatedFieldsNamed(slice: Json): readonly string[] {
  const done = listOf(fieldsOf(slice).done);
  return done.filter((item) => isChecks(item) && namesAGatedField(item)).map((item) => textOf(fieldsOf(item).id));
}
