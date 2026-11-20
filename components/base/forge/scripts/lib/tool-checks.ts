import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { listOf } from "./json-values.ts";

const says =
  "Added by forge, as the plan lists no checks item: the toolchain's checks, such as types, lint, format and " +
  "dead code, and its whole test run pass.";

function isChecks(item: Json): boolean {
  return fieldsOf(fieldsOf(item).proof ?? null).kind === "checks";
}

function freeId(done: readonly Json[]): string {
  return done.some((item) => fieldsOf(item).id === "checks") ? "forge-checks" : "checks";
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
