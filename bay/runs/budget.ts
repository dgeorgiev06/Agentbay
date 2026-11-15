import type { Json, Spend } from "../contracts.ts";
import type { Budget } from "../generated/mode.ts";
import { numberField } from "../json.ts";

export const measures = ["items", "usd", "tokens", "minutes"] as const;

export type Measure = (typeof measures)[number];

export type Overrun = {
  readonly measure: Measure;
  readonly limit: number;
  readonly spent: number;
};

export type BudgetFrame = {
  readonly limit: Budget;
  spent: Spend;
  readonly parent: BudgetFrame | undefined;
};

export const noSpend: Spend = { items: 0, usd: 0, tokens: 0, minutes: 0 };

function spendOf(amount: (measure: Measure) => number): Spend {
  return { items: amount("items"), usd: amount("usd"), tokens: amount("tokens"), minutes: amount("minutes") };
}

function budgetOf(limit: (measure: Measure) => number | undefined): Budget {
  const items = limit("items");
  const usd = limit("usd");
  const tokens = limit("tokens");
  const minutes = limit("minutes");
  return {
    ...(items === undefined ? {} : { items }),
    ...(usd === undefined ? {} : { usd }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(minutes === undefined ? {} : { minutes }),
  };
}

export function addSpend(first: Spend, second: Spend): Spend {
  return spendOf((measure) => first[measure] + second[measure]);
}

export function subtractSpend(first: Spend, second: Spend): Spend {
  return spendOf((measure) => first[measure] - second[measure]);
}

export function smallestBudget(budgets: readonly (Budget | undefined)[]): Budget {
  return budgetOf((measure) => {
    const limits = budgets.flatMap((budget) => budget?.[measure] ?? []);
    return limits.length === 0 ? undefined : Math.min(...limits);
  });
}

export function extendedBudget(budget: Budget, extra: Budget): Budget {
  return budgetOf((measure) => {
    const limit = budget[measure];
    return limit === undefined ? undefined : limit + (extra[measure] ?? 0);
  });
}

export function addBudgets(first: Budget, second: Budget): Budget {
  return budgetOf((measure) => {
    const left = first[measure];
    const right = second[measure];
    return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  });
}

export function remainingBudget(limit: Budget, spent: Spend): Budget {
  return budgetOf((measure) => {
    const value = limit[measure];
    return value === undefined ? undefined : value - spent[measure];
  });
}

function overrunOf(limit: Budget, spent: Spend): Overrun | undefined {
  for (const measure of measures) {
    const value = limit[measure];
    if (value !== undefined && spent[measure] > value) {
      return { measure, limit: value, spent: spent[measure] };
    }
  }
  return undefined;
}

export function rootFrame(limit: Budget): BudgetFrame {
  return { limit, spent: noSpend, parent: undefined };
}

export function childFrame(parent: BudgetFrame, own: Budget | undefined, extra: Budget): BudgetFrame {
  const ownLimit = own === undefined ? undefined : extendedBudget(own, extra);
  return { limit: smallestBudget([ownLimit, frameRemaining(parent)]), spent: noSpend, parent };
}

function chainOf(frame: BudgetFrame): readonly BudgetFrame[] {
  return frame.parent === undefined ? [frame] : [frame, ...chainOf(frame.parent)];
}

export function charge(frame: BudgetFrame, spent: Spend): void {
  for (const member of chainOf(frame)) {
    member.spent = addSpend(member.spent, spent);
  }
}

export function frameRemaining(frame: BudgetFrame): Budget {
  return smallestBudget(chainOf(frame).map((member) => remainingBudget(member.limit, member.spent)));
}

export function frameOverrun(frame: BudgetFrame): Overrun | undefined {
  for (const member of chainOf(frame)) {
    const overrun = overrunOf(member.limit, member.spent);
    if (overrun !== undefined) {
      return overrun;
    }
  }
  return undefined;
}

export function budgetFromJson(value: Json): Budget {
  return budgetOf((measure) => numberField(value, measure));
}

export function spendFromJson(value: Json): Spend {
  return spendOf((measure) => numberField(value, measure) ?? 0);
}

export function budgetProblems(budget: Budget): readonly string[] {
  return measures.flatMap((measure) => {
    const value = budget[measure];
    if (value === undefined || (Number.isFinite(value) && value >= 0)) {
      return [];
    }
    return [`${measure} must be a number of at least 0, but it is ${String(value)}.`];
  });
}
