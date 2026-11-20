import type { Plan } from "./plan.ts";

export type Conditions = {
  readonly file: string;
  readonly ids: readonly string[];
};

export type ConditionProblem =
  | {
      readonly kind: "condition not met";
      readonly level: "error";
      readonly condition: string;
      readonly sentence: string;
    }
  | {
      readonly kind: "condition not held";
      readonly level: "error";
      readonly slice: string;
      readonly condition: string;
      readonly sentence: string;
    };

function notMet(condition: string, file: string): ConditionProblem {
  const sentence =
    `No slice meets the condition ${condition} of ${file}. ` +
    "Name it in meets of the slice that makes it true, or add a slice for it.";
  return { kind: "condition not met", level: "error", condition, sentence };
}

function notHeld(slice: string, condition: string, file: string): ConditionProblem {
  const sentence =
    `${slice} meets ${condition}, which ${file} does not hold. ` +
    "Name in meets only conditions the requirements hold.";
  return { kind: "condition not held", level: "error", slice, condition, sentence };
}

export function unmetConditions(plan: Plan, conditions: Conditions): readonly ConditionProblem[] {
  const met = plan.slices.flatMap((slice) => slice.meets ?? []);
  return conditions.ids.filter((id) => !met.includes(id)).map((id) => notMet(id, conditions.file));
}

export function conditionsNotHeld(plan: Plan, conditions: Conditions): readonly ConditionProblem[] {
  return plan.slices.flatMap((slice) =>
    (slice.meets ?? [])
      .filter((id) => !conditions.ids.includes(id))
      .map((id) => notHeld(slice.name, id, conditions.file)),
  );
}
