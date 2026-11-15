import type { Json } from "../../../../../bay/sdk.ts";

export type Fields = { readonly [key: string]: Json };

export function isFields(value: Json | undefined): value is Fields {
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

export function numberOf(value: Json | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function textsOf(value: Json | undefined): readonly string[] {
  return listOf(value).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

export function parsedJson(text: string): Json | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJson(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isJson(value: unknown): value is Json {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((entry: unknown) => isJson(entry));
  }
  return typeof value === "object" && Object.values(value).every((entry: unknown) => isJson(entry));
}
