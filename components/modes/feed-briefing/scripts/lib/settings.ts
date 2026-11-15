import { parseIsoTime, type Json } from "../../../../../bay/sdk.ts";
import { fieldsOf, textOf, type Fields } from "./json.ts";

export type Settings = {
  readonly selector: Fields;
  readonly lookbackMilliseconds: number;
  readonly maxItems: number;
};

const defaultLookback = "7d";

const defaultMaxItems = 100;

const unitMilliseconds: Readonly<Record<string, number>> = { h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function durationMilliseconds(text: string): number {
  const unit = unitMilliseconds[text.slice(-1)] ?? 0;
  return Number(text.slice(0, -1)) * unit;
}

export function settingsOf(settings: Readonly<Record<string, Json>>): Settings {
  const maxItems = settings.maxItems;
  return {
    selector: fieldsOf(settings.selector),
    lookbackMilliseconds: durationMilliseconds(textOf(settings.lookback) ?? defaultLookback),
    maxItems: typeof maxItems === "number" ? maxItems : defaultMaxItems,
  };
}

export function timeOf(value: Json | undefined): number | undefined {
  const text = textOf(value);
  return text === undefined ? undefined : parseIsoTime(text)?.getTime();
}
