import { createHash } from "node:crypto";
import type { Json } from "./contracts.ts";

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toJson(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((element: unknown) => toJson(element));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, element]) => [key, toJson(element)]));
  }
  throw new Error(`A value of type ${typeof value} is not JSON.`);
}

export function parseJson(text: string): Json {
  const parsed: unknown = JSON.parse(text);
  return toJson(parsed);
}

export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map((element: unknown) => canonicalJson(toJson(element))).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(toJson(value[key]))}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashOf(value: Json): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function byteSize(value: Json): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function fieldOf(value: Json, name: string): Json | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, name)) {
    return undefined;
  }
  return toJson(value[name]);
}

export function numberField(value: Json, name: string): number | undefined {
  const field = fieldOf(value, name);
  return typeof field === "number" ? field : undefined;
}

export function textField(value: Json, name: string): string | undefined {
  const field = fieldOf(value, name);
  return typeof field === "string" ? field : undefined;
}

export function textsField(value: Json, name: string): readonly string[] {
  const field = fieldOf(value, name);
  if (!Array.isArray(field)) {
    return [];
  }
  return field.flatMap((element) => (typeof element === "string" ? [element] : []));
}
