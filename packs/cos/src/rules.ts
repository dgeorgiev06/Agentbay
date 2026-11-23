import { join } from "node:path";

export const RECALL_LIMIT = 50;

export class UserError extends Error {}

export interface NewFact {
  fact: string;
  topic: string | null;
}

export interface FactFilter {
  topic: string | null;
  query: string | null;
}

export const SCHEMA = {
  remember: {
    input: { fact: "string", topic: "string?" },
    output: { id: "string", fact: "string", topic: "string|null" },
  },
  recall: {
    input: { topic: "string?", query: "string?" },
    output: { facts: "{id, fact, topic, created}[] newest first, at most 50" },
  },
  forget: {
    input: { id: "string" },
    output: { id: "string", forgotten: "true" },
  },
};

export function resolveDataDir(
  env: Record<string, string | undefined>,
  home: string,
): string {
  return (
    env.CLAUDE_PLUGIN_DATA || env.AGENTBAY_DATA_DIR || join(home, ".agentbay", "cos")
  );
}

export function parseInput(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UserError("Input is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserError("Input must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function optionalText(input: Record<string, unknown>, name: string): string | null {
  const value = input[name];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new UserError(`${name} must be a string.`);
  return value.trim() || null;
}

export function parseRemember(input: Record<string, unknown>): NewFact {
  const fact = optionalText(input, "fact");
  if (fact === null) throw new UserError("fact must not be blank.");
  const topic = optionalText(input, "topic");
  return { fact, topic: topic && topic.toLowerCase() };
}

export function parseRecall(input: Record<string, unknown>): FactFilter {
  const topic = optionalText(input, "topic");
  return { topic: topic && topic.toLowerCase(), query: optionalText(input, "query") };
}

export function parseForget(input: Record<string, unknown>): string {
  const id = optionalText(input, "id");
  if (id === null) throw new UserError("id must not be blank.");
  return id;
}
