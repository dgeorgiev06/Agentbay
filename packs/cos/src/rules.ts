export const recallLimit = 50;

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export type NewFact = { readonly fact: string; readonly topic: string | null };

export type FactFilter = { readonly topic: string | null; readonly query: string | null };

export type Fact = {
  readonly id: string;
  readonly fact: string;
  readonly topic: string | null;
  readonly created: string;
};

export const schema = {
  remember: {
    input: { fact: "string, required", topic: "string, optional, lowercased" },
    output: { id: "string", fact: "string", topic: "string or null" },
  },
  recall: {
    input: { topic: "string, optional", query: "string, optional, matched inside the fact" },
    output: { facts: `[{ id, fact, topic, created }] newest first, at most ${recallLimit}` },
  },
  forget: {
    input: { id: "string, required, as returned by remember or recall" },
    output: { id: "string", forgotten: true },
  },
  export: {
    input: {},
    output: { facts: "[{ id, fact, topic, created }] every fact, newest first" },
  },
  setup: {
    input: {},
    output: { allow: "permission rules to add to the user's settings" },
  },
  schema: {
    input: {},
    output: { actions: "this description" },
  },
};

export const permissions = { allow: ["Bash(cos *)"] };

function fail<T>(error: string): Result<T> {
  return { ok: false, error };
}

function succeed<T>(value: T): Result<T> {
  return { ok: true, value };
}

function optionalText(input: Record<string, unknown>, name: string): Result<string | null> {
  const value = input[name];
  if (value === undefined || value === null) {
    return succeed(null);
  }
  if (typeof value !== "string") {
    return fail(`The ${name} must be a string.`);
  }
  return succeed(value.trim() || null);
}

function lowercased(text: string | null): string | null {
  return text === null ? null : text.toLowerCase();
}

export function parseInput(raw: string): Result<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return succeed(parsed as Record<string, unknown>);
    }
  } catch {
    return fail("The input is not valid JSON: pass one JSON object.");
  }
  return fail("The input must be a JSON object.");
}

export function normalizeRemember(input: Record<string, unknown>): Result<NewFact> {
  const fact = optionalText(input, "fact");
  const topic = optionalText(input, "topic");
  if (!fact.ok) {
    return fact;
  }
  if (!topic.ok) {
    return topic;
  }
  if (fact.value === null) {
    return fail("The fact is blank: say what to remember.");
  }
  return succeed({ fact: fact.value, topic: lowercased(topic.value) });
}

export function normalizeRecall(input: Record<string, unknown>): Result<FactFilter> {
  const topic = optionalText(input, "topic");
  const query = optionalText(input, "query");
  if (!topic.ok) {
    return topic;
  }
  if (!query.ok) {
    return query;
  }
  return succeed({ topic: lowercased(topic.value), query: query.value });
}

export function parseId(input: Record<string, unknown>): Result<string> {
  const id = optionalText(input, "id");
  if (!id.ok) {
    return id;
  }
  return id.value === null ? fail("The id is blank: recall the facts to see the ids.") : succeed(id.value);
}
