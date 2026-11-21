import type { Json } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import type { Outcome } from "../outcome.ts";

export type ItemName = { readonly id: string; readonly title?: string };

export type DeclaredName = NonNullable<Extract<WorkflowStep, { readonly foreach: string }>["itemName"]>;

type Read = (reference: string) => Outcome<Json>;

const longestId = 40;

const longestTitle = 80;

const cutMark = "…";

const breaking = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function withoutBreaks(text: string): string {
  return text.replace(breaking, " ");
}

function withBrackets(text: string): string {
  return text.replaceAll("(", "[").replaceAll(")", "]");
}

function squeezed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function oneLine(text: string): string {
  return squeezed(withBrackets(withoutBreaks(text)));
}

function cut(text: string, longest: number): string {
  const characters = Array.from(text);
  return characters.length <= longest ? text : `${characters.slice(0, longest - 1).join("")}${cutMark}`;
}

function boundedName(text: string, longest: number): string {
  return cut(oneLine(text), longest);
}

function textOf(value: Json): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function namePart(read: Read, reference: string, longest: number): string | undefined {
  const resolved = read(reference);
  const text = resolved.ok ? textOf(resolved.value) : undefined;
  const bounded = text === undefined ? "" : boundedName(text, longest);
  return bounded === "" ? undefined : bounded;
}

export function itemNameOf(declared: DeclaredName | undefined, read: Read): ItemName | undefined {
  if (declared === undefined) {
    return undefined;
  }
  const id = namePart(read, declared.id, longestId);
  if (id === undefined) {
    return undefined;
  }
  const title = declared.title === undefined ? undefined : namePart(read, declared.title, longestTitle);
  return title === undefined ? { id } : { id, title };
}

function isBounded(text: string | undefined, longest: number): boolean {
  return text === undefined || (text !== "" && boundedName(text, longest) === text);
}

export function isItemName(name: ItemName): boolean {
  return isBounded(name.id, longestId) && isBounded(name.title, longestTitle);
}

function ordinal(position: number): string {
  const tens = position % 100;
  const suffixes = ["th", "st", "nd", "rd"];
  const suffix = tens >= 11 && tens <= 13 ? "th" : (suffixes[position % 10] ?? "th");
  return `${String(position)}${suffix}`;
}

export function itemPlaceWords(item: number, count: number | undefined): string {
  const of = count === undefined ? "item" : `of ${String(count)} ${count === 1 ? "item" : "items"}`;
  return `the ${ordinal(item + 1)} ${of}`;
}

export function itemNameWords(name: ItemName): string {
  return name.title === undefined ? name.id : `${name.id} (${name.title})`;
}
