import type { Json } from "../../../../../bay/sdk.ts";

const fewestSideBySide = 2;

const mostSideBySide = 8;

export function sideBySideOf(setting: Json | undefined): number {
  const asked = typeof setting === "number" && Number.isInteger(setting) ? setting : fewestSideBySide;
  return Math.min(mostSideBySide, Math.max(fewestSideBySide, asked));
}

export function batchesOf<Item>(items: readonly Item[], size: number): readonly (readonly Item[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, at) => items.slice(at * size, (at + 1) * size));
}
