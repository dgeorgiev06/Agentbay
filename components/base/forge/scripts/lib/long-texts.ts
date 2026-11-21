import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { grouped } from "./card-lines.ts";

export type Spelled = {
  readonly value: Json;
  readonly forms: number;
  readonly refused: readonly string[];
};

type Part = {
  readonly repeat: string;
  readonly times: number;
};

type Read = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string };

const mostParts = 20;

const mostCodePoints = 10_000;

const formKey = "$text";

const partWords = '{"repeat": "<text>", "times": <count>}';

function isForm(value: Json): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === formKey;
}

function isCount(value: Json | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function partOf(value: Json): Part | undefined {
  if (typeof value === "string") {
    return { repeat: value, times: 1 };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const { repeat, times, ...more } = fieldsOf(value);
  const fits = typeof repeat === "string" && repeat !== "" && isCount(times) && Object.keys(more).length === 0;
  return fits ? { repeat, times } : undefined;
}

function codePoints(part: Part): number {
  return Array.from(part.repeat).length * part.times;
}

function refusedPart(index: number): Read {
  const reason =
    `part ${String(index + 1)} is neither a text nor ${partWords}, ` +
    "with a text that is not empty and a whole count from 1";
  return { ok: false, reason };
}

function partsRead(parts: readonly (Part | undefined)[]): Read {
  const unread = parts.findIndex((part) => part === undefined);
  if (unread >= 0) {
    return refusedPart(unread);
  }
  const read = parts.filter((part) => part !== undefined);
  const length = read.reduce((sum, part) => sum + codePoints(part), 0);
  if (length > mostCodePoints) {
    const reason =
      `it spells ${grouped(length)} characters, counted in Unicode code points, and a text said by rule ` +
      `spells at most ${grouped(mostCodePoints)}`;
    return { ok: false, reason };
  }
  return { ok: true, text: read.map((part) => part.repeat.repeat(part.times)).join("") };
}

function formRead(listed: Json | undefined): Read {
  if (!Array.isArray(listed)) {
    return { ok: false, reason: `its "${formKey}" is not a list; give a list of parts, each a text or ${partWords}` };
  }
  const parts: readonly Json[] = listed;
  if (parts.length > mostParts) {
    const reason =
      `it has ${String(parts.length)} parts, and a text said by rule has at most ${String(mostParts)}; ` +
      "join parts that repeat the same text";
    return { ok: false, reason };
  }
  return partsRead(parts.map(partOf));
}

function formSpelled(value: Json): Spelled {
  const read = formRead(fieldsOf(value)[formKey]);
  return read.ok ? { value: read.text, forms: 1, refused: [] } : { value, forms: 1, refused: [read.reason] };
}

function together(spelled: readonly Spelled[]): Omit<Spelled, "value"> {
  return {
    forms: spelled.reduce((sum, each) => sum + each.forms, 0),
    refused: spelled.flatMap((each) => each.refused),
  };
}

function entriesSpelled(value: Json): Spelled {
  const entries = Object.entries(fieldsOf(value)).map(([key, inner]) => ({ key, spelled: spelledOut(inner) }));
  const fields = Object.fromEntries(entries.map(({ key, spelled }) => [key, spelled.value]));
  return { value: fields, ...together(entries.map(({ spelled }) => spelled)) };
}

export function spelledOut(value: Json): Spelled {
  if (Array.isArray(value)) {
    const items: readonly Json[] = value;
    const spelled = items.map(spelledOut);
    return { value: spelled.map((each) => each.value), ...together(spelled) };
  }
  if (value === null || typeof value !== "object") {
    return { value, forms: 0, refused: [] };
  }
  return isForm(value) ? formSpelled(value) : entriesSpelled(value);
}
