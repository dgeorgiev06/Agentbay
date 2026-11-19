import type { Json } from "../../../../../bay/sdk.ts";

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

export function textOf(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

export function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

export function textsOf(value: Json | undefined): readonly string[] {
  return listOf(value).filter((entry) => typeof entry === "string");
}
