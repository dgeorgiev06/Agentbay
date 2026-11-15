import { parseIsoTime, type Json } from "../../../../../bay/sdk.ts";
import { fieldsOf, isFields, listOf, parsedJson, textOf, textsOf, type Fields } from "./json.ts";

export type Item = {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly at: string;
  readonly title: string | null;
  readonly text: string;
  readonly url: string | null;
  readonly author: string | null;
  readonly labels: readonly string[];
  readonly data: Fields;
};

export const localSource = "local";

function nullableText(value: Json | undefined): string | null {
  return textOf(value) ?? null;
}

export function itemOf(value: Json | undefined): Item {
  const fields = fieldsOf(value);
  return {
    id: textOf(fields.id) ?? "",
    kind: textOf(fields.kind) ?? "",
    source: textOf(fields.source) ?? "",
    at: textOf(fields.at) ?? "",
    title: nullableText(fields.title),
    text: textOf(fields.text) ?? "",
    url: nullableText(fields.url),
    author: nullableText(fields.author),
    labels: textsOf(fields.labels),
    data: fieldsOf(fields.data),
  };
}

export function itemsOf(value: Json | undefined): readonly Item[] {
  return listOf(value).map((entry) => itemOf(entry));
}

export function millisecondsOf(time: string): number | undefined {
  return parseIsoTime(time)?.getTime();
}

function storedJson(text: Json | undefined): Json | undefined {
  return typeof text === "string" ? parsedJson(text) : undefined;
}

export function itemOfRow(row: Fields): Item {
  const data = storedJson(row.data);
  return itemOf({ ...row, labels: storedJson(row.labels) ?? [], data: isFields(data) ? data : {} });
}

export function rowParameters(item: Item, storedAt: string): Fields {
  return {
    id: item.id,
    kind: item.kind,
    source: item.source,
    at: item.at,
    at_ms: millisecondsOf(item.at) ?? 0,
    title: item.title,
    text: item.text,
    url: item.url,
    author: item.author,
    labels: JSON.stringify(item.labels),
    data: JSON.stringify(item.data),
    stored_at: storedAt,
  };
}
