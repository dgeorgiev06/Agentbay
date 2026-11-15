import type { Json } from "./contracts.ts";

const deepestNesting = 64;

function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonAt(value: unknown, depth: number): value is Json {
  if (depth > deepestNesting) {
    return false;
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item: unknown) => isJsonAt(item, depth + 1));
  }
  if (isRecordValue(value)) {
    return Object.values(value).every((item) => isJsonAt(item, depth + 1));
  }
  return false;
}

export function isJson(value: unknown): value is Json {
  return isJsonAt(value, 0);
}

export function isJsonRecord(value: unknown): value is { readonly [key: string]: Json } {
  return isRecordValue(value) && isJson(value);
}

export function parsedLine(line: string): unknown {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed;
  } catch {
    return undefined;
  }
}
