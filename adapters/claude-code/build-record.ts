import { createHash } from "node:crypto";
import type { Problem } from "./adapter-types.ts";
import type { BlockAddition } from "./coordinator.ts";
import { isRecord } from "./guard-input.ts";
import { parseObject } from "./json-file.ts";
import type { McpAddition } from "./mcp-config.ts";
import type { SettingsAddition } from "./settings.ts";

export const recordPath = ".agentbay/build.json";

export const unreadableRecord: Problem = {
  file: recordPath,
  path: "",
  message: "the build record cannot be read",
  fix: "restore it from version control, or delete it and remove what it listed by hand",
};

export type Addition = SettingsAddition | McpAddition | BlockAddition;

export type CreatedFile = {
  readonly path: string;
  readonly sha256: string;
};

export type MergedFile = {
  readonly path: string;
  readonly existedBefore: boolean;
  readonly originalText: string | null;
  readonly writtenSha256: string;
  readonly addition: Addition;
};

export type BuildRecord = {
  readonly version: 1;
  readonly adapter: "claude-code";
  readonly created: readonly CreatedFile[];
  readonly merged: readonly MergedFile[];
};

export type RecordReading =
  | { readonly kind: "none" }
  | { readonly kind: "record"; readonly record: BuildRecord }
  | { readonly kind: "unreadable" };

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function settingsAdditionOf(value: Readonly<Record<string, unknown>>): Addition | undefined {
  const { entry, createdHooks, createdPreToolUse } = value;
  if (!isRecord(entry) || typeof createdHooks !== "boolean" || typeof createdPreToolUse !== "boolean") {
    return undefined;
  }
  return { kind: "settings", entry, createdHooks, createdPreToolUse };
}

function mcpAdditionOf(value: Readonly<Record<string, unknown>>): Addition | undefined {
  const { server, createdServers } = value;
  if (!isRecord(server) || typeof createdServers !== "boolean") {
    return undefined;
  }
  return { kind: "mcp", server, previous: value["previous"] ?? null, createdServers };
}

function additionOf(value: unknown): Addition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (value["kind"]) {
    case "settings":
      return settingsAdditionOf(value);
    case "mcp":
      return mcpAdditionOf(value);
    case "claude-md":
      return typeof value["separator"] === "string" ? { kind: "claude-md", separator: value["separator"] } : undefined;
    default:
      return undefined;
  }
}

function createdOf(value: unknown): CreatedFile | undefined {
  return isRecord(value) && typeof value["path"] === "string" && typeof value["sha256"] === "string"
    ? { path: value["path"], sha256: value["sha256"] }
    : undefined;
}

function mergedOf(value: unknown): MergedFile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { path, existedBefore, originalText, writtenSha256 } = value;
  const addition = additionOf(value["addition"]);
  const textOrNull = originalText === null || typeof originalText === "string";
  if (typeof path !== "string" || typeof existedBefore !== "boolean" || typeof writtenSha256 !== "string") {
    return undefined;
  }
  return textOrNull && addition !== undefined
    ? { path, existedBefore, originalText, writtenSha256, addition }
    : undefined;
}

function allRead<T>(values: unknown, read: (value: unknown) => T | undefined): readonly T[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const items: T[] = [];
  for (const value of values) {
    const item = read(value);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

export function readRecord(text: string | undefined): RecordReading {
  if (text === undefined) {
    return { kind: "none" };
  }
  const parsed = parseObject(text);
  if (!parsed.ok || parsed.value["version"] !== 1 || parsed.value["adapter"] !== "claude-code") {
    return { kind: "unreadable" };
  }
  const created = allRead(parsed.value["created"], createdOf);
  const merged = allRead(parsed.value["merged"], mergedOf);
  if (created === undefined || merged === undefined) {
    return { kind: "unreadable" };
  }
  return { kind: "record", record: { version: 1, adapter: "claude-code", created, merged } };
}

export function recordText(record: BuildRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
