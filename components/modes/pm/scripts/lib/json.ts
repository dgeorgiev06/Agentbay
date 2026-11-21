import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

export function listAt(value: Json, field: string): readonly Json[] {
  const found = fieldsOf(value)[field];
  return isList(found) ? found : [];
}

export function textAt(value: Json, field: string): string {
  const found = fieldsOf(value)[field];
  return typeof found === "string" ? found : "";
}

export function textsAt(value: Json, field: string): readonly string[] {
  return listAt(value, field).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

export function numberAt(value: Json, field: string): number {
  const found = fieldsOf(value)[field];
  return typeof found === "number" ? found : 0;
}

export function flagAt(value: Json, field: string): boolean {
  return fieldsOf(value)[field] === true;
}
