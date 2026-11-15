import type { Json } from "../../../../../bay/sdk.ts";

export type Fields = { readonly [key: string]: Json };

function isFields(value: Json | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fieldsOf(value: Json | undefined): Fields {
  return isFields(value) ? value : {};
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

export function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

export function textOf(value: Json | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberOf(value: Json | undefined): number {
  return typeof value === "number" ? value : 0;
}

export function textsOf(value: Json | undefined): readonly string[] {
  return listOf(value).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}
