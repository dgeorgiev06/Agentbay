import type { Json } from "../../../../../bay/sdk.ts";

const leftOutSideBySide = 2;

export function sideBySideOf(setting: Json | undefined): number {
  return typeof setting === "number" ? setting : leftOutSideBySide;
}
