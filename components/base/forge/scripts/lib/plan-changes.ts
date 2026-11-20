import { canonicalJson, fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { joined } from "./card-lines.ts";
import { listOf, textOf } from "./json-values.ts";

type Part = {
  readonly name: string;
  readonly value: (planned: JsonFields) => Json | undefined;
};

const sliceParts: readonly Part[] = [
  { name: "title", value: (planned) => planned.title },
  { name: "kind", value: (planned) => fieldsOf(planned.slice ?? null).kind },
  { name: "scope", value: (planned) => fieldsOf(planned.slice ?? null).scope },
  { name: "after", value: (planned) => fieldsOf(planned.slice ?? null).after },
  { name: "done", value: (planned) => fieldsOf(planned.slice ?? null).done },
  { name: "meets", value: (planned) => planned.meets },
  { name: "interface", value: (planned) => planned.interface },
  { name: "crossesModulesBecause", value: (planned) => planned.crossesModulesBecause },
];

const planParts: readonly Part[] = [
  { name: "title", value: (plan) => plan.title },
  { name: "oneAfterAnotherBecause", value: (plan) => plan.oneAfterAnotherBecause },
];

function slicesByName(plan: Json): ReadonlyMap<string, JsonFields> {
  const slices = listOf(fieldsOf(plan).slices).map(fieldsOf);
  return new Map(slices.map((planned) => [textOf(fieldsOf(planned.slice ?? null).name), planned]));
}

function differing(parts: readonly Part[], first: JsonFields, second: JsonFields): readonly string[] {
  const shown = (value: Json | undefined): string => (value === undefined ? "" : canonicalJson(value));
  return parts.filter((part) => shown(part.value(first)) !== shown(part.value(second))).map((part) => part.name);
}

export function planChanges(first: Json, second: Json): readonly string[] {
  const before = slicesByName(first);
  const after = slicesByName(second);
  const plan = differing(planParts, fieldsOf(first), fieldsOf(second)).map((part) => `the plan's ${part}`);
  const changed = [...after].flatMap(([name, planned]) => {
    const earlier = before.get(name);
    if (earlier === undefined) {
      return [`${name} added`];
    }
    const parts = differing(sliceParts, earlier, planned);
    return parts.length === 0 ? [] : [`${name}'s ${joined(parts)}`];
  });
  const removed = [...before.keys()].filter((name) => !after.has(name)).map((name) => `${name} removed`);
  return [...plan, ...changed, ...removed];
}
