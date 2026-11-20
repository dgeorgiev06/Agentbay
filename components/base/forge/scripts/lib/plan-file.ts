import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import type { Written } from "./commit-files.ts";

export type Named = {
  readonly requirements: string;
  readonly design: string;
};

const plansFolder = "docs/plans";

const numbered = /^(\d{4})-/;

export function nextFreeNumber(names: readonly string[]): string {
  const numbers = names.map((name) => numbered.exec(name)?.[1]).filter((number) => number !== undefined);
  const highest = Math.max(0, ...numbers.map(Number));
  return String(highest + 1).padStart(4, "0");
}

export function plansIn(folder: string): string {
  return `${folder}/${plansFolder}`;
}

export function planDocument(plan: Json, named: Named): Json {
  const { title = null, oneAfterAnotherBecause, slices = null } = fieldsOf(plan);
  const because = oneAfterAnotherBecause === undefined ? {} : { oneAfterAnotherBecause };
  return { title, requirements: named.requirements, design: named.design, ...because, slices };
}

export type Filed = Named & {
  readonly job: string;
  readonly names: readonly string[];
};

export function planFile(plan: Json, filed: Filed): Written {
  const path = `${plansFolder}/${nextFreeNumber(filed.names)}-${filed.job}.yaml`;
  return { path, text: `${JSON.stringify(planDocument(plan, filed), null, 2)}\n` };
}
