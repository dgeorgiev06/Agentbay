import type { Json } from "../../../../../bay/sdk.ts";
import type { Item } from "./items.ts";
import { millisecondsOf } from "./items.ts";
import { fieldsOf, numberOf, textOf, textsOf } from "./json.ts";

export type Selector = {
  readonly authors: readonly string[];
  readonly labels: readonly string[];
  readonly text: readonly string[];
  readonly kinds: readonly string[];
  readonly since: number | undefined;
  readonly until: number | undefined;
  readonly limit: number | undefined;
};

function timeOf(value: Json | undefined): number | undefined {
  const text = textOf(value);
  return text === undefined ? undefined : millisecondsOf(text);
}

export function selectorOf(value: Json | undefined): Selector {
  const fields = fieldsOf(value);
  return {
    authors: textsOf(fields.authors),
    labels: textsOf(fields.labels),
    text: textsOf(fields.text),
    kinds: textsOf(fields.kinds),
    since: timeOf(fields.since),
    until: timeOf(fields.until),
    limit: numberOf(fields.limit),
  };
}

function normalName(name: string): string {
  return name.trim().toLowerCase().replace(/^@/, "");
}

export function globMatches(pattern: string, text: string): boolean {
  const [head = "", ...rest] = pattern.split("*");
  if (rest.length === 0) {
    return pattern === text;
  }
  const tail = rest.pop() ?? "";
  if (head.length + tail.length > text.length || !text.startsWith(head) || !text.endsWith(tail)) {
    return false;
  }
  let position = head.length;
  const end = text.length - tail.length;
  for (const part of rest) {
    const found = text.indexOf(part, position);
    if (found < 0 || found + part.length > end) {
      return false;
    }
    position = found + part.length;
  }
  return true;
}

function authorMatches(selector: Selector, item: Item): boolean {
  if (selector.authors.length === 0) {
    return true;
  }
  const author = normalName(item.author ?? "");
  return author !== "" && selector.authors.some((pattern) => globMatches(normalName(pattern), author));
}

function labelMatches(selector: Selector, item: Item): boolean {
  if (selector.labels.length === 0) {
    return true;
  }
  const labels = new Set(item.labels.map(normalName));
  return selector.labels.some((label) => labels.has(normalName(label)));
}

function textMatches(selector: Selector, item: Item): boolean {
  if (selector.text.length === 0) {
    return true;
  }
  const haystack = `${item.title ?? ""}\n${item.text}`.toLowerCase();
  return selector.text.some((term) => haystack.includes(term.toLowerCase()));
}

function kindMatches(selector: Selector, item: Item): boolean {
  return selector.kinds.length === 0 || selector.kinds.includes(item.kind);
}

function timeMatches(selector: Selector, item: Item): boolean {
  const at = millisecondsOf(item.at);
  if (at === undefined) {
    return selector.since === undefined && selector.until === undefined;
  }
  const afterSince = selector.since === undefined || at >= selector.since;
  const beforeUntil = selector.until === undefined || at < selector.until;
  return afterSince && beforeUntil;
}

export function matches(selector: Selector, item: Item): boolean {
  return (
    kindMatches(selector, item) &&
    timeMatches(selector, item) &&
    authorMatches(selector, item) &&
    labelMatches(selector, item) &&
    textMatches(selector, item)
  );
}
