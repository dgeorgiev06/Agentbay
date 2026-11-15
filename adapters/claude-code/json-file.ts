import { isRecord } from "./guard-input.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export type ParsedObject = { readonly ok: true; readonly value: JsonObject } | { readonly ok: false };

export function parseObject(text: string | undefined): ParsedObject {
  if (text === undefined) {
    return { ok: true, value: {} };
  }
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function listOf(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value.map((item: unknown) => item) : undefined;
}

export function withMember(object: JsonObject, key: string, value: unknown): JsonObject {
  return { ...object, [key]: value };
}

export function withoutMember(object: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
}

export function jsonText(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function isEmptyObject(value: JsonObject): boolean {
  return Object.keys(value).length === 0;
}
