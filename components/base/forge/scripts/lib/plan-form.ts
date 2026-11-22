import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { claimSentence } from "./gate-words.ts";
import { namedTests } from "./handed-tests.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";
import type { Plan, PlannedSlice } from "./plan.ts";
import { sliceOf } from "./slice-form.ts";
import { testsFromNamed } from "./tool-checks.ts";

function plannedSliceOf(value: Json): PlannedSlice {
  const planned = fieldsOf(value);
  const slice = sliceOf(planned.slice);
  const { meets, crossesModulesBecause } = planned;
  const named = planned.interface;
  return {
    name: slice.name,
    title: textOf(planned.title),
    kind: slice.kind,
    scope: slice.scope,
    after: slice.after,
    tests: namedTests(slice),
    ...(Array.isArray(meets) ? { meets: textsOf(meets) } : {}),
    ...(Array.isArray(named) ? { interface: textsOf(named) } : {}),
    ...(typeof crossesModulesBecause === "string" ? { crossesModulesBecause } : {}),
  };
}

export function planOf(value: Json): Plan {
  const fields = fieldsOf(value);
  const { oneAfterAnotherBecause, requirements, design } = fields;
  return {
    title: textOf(fields.title),
    slices: listOf(fields.slices).map(plannedSliceOf),
    ...(typeof oneAfterAnotherBecause === "string" ? { oneAfterAnotherBecause } : {}),
    ...(typeof requirements === "string" ? { requirements } : {}),
    ...(typeof design === "string" ? { design } : {}),
  };
}

export type NamedTwice = {
  readonly at: number;
  readonly sentence: string;
};

export function twiceNamed(plan: Plan): readonly NamedTwice[] {
  return plan.slices.flatMap((slice, at) => {
    const first = plan.slices.findIndex((other) => other.name === slice.name);
    if (first === at) {
      return [];
    }
    const sentence =
      `Slices ${String(first + 1)} and ${String(at + 1)} are both named ${slice.name}. ` +
      "Give each slice a name of its own, since an after names a slice by it.";
    return [{ at, sentence }];
  });
}

export type GateClaimed = {
  readonly at: string;
  readonly sentence: string;
};

export function gatesClaimed(document: Json): readonly GateClaimed[] {
  return listOf(fieldsOf(document).slices).flatMap((planned, at) => {
    const slice = fieldsOf(planned).slice ?? null;
    const claimed = testsFromNamed(slice);
    if (claimed.length === 0) {
      return [];
    }
    const sentence = claimSentence(sliceOf(slice).name, claimed);
    return [{ at: `/slices/${String(at)}/slice/done`, sentence }];
  });
}
