import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addBudgets,
  addSpend,
  budgetFromJson,
  budgetProblems,
  charge,
  childFrame,
  extendedBudget,
  frameOverrun,
  frameRemaining,
  noSpend,
  overrunOf,
  remainingBudget,
  rootFrame,
  smallestBudget,
  spendFromJson,
  subtractSpend,
} from "../bay/budget.ts";

const spend = (items: number, usd = 0) => ({ items, usd, tokens: 0, minutes: 0 });

test("the budget of a run is the smallest limit per measure; a measure nobody limits stays unlimited", () => {
  assert.deepEqual(smallestBudget([{ items: 10, usd: 1 }, undefined, { items: 4, tokens: 100 }]), {
    items: 4,
    usd: 1,
    tokens: 100,
  });
  assert.deepEqual(smallestBudget([undefined, {}]), {});
});

test("spend adds and subtracts per measure", () => {
  assert.deepEqual(addSpend(spend(1, 0.5), spend(2, 0.25)), spend(3, 0.75));
  assert.deepEqual(subtractSpend(spend(3, 0.75), spend(1, 0.5)), spend(2, 0.25));
});

test("an extension raises only limited measures; added extensions sum", () => {
  assert.deepEqual(extendedBudget({ items: 2 }, { items: 3, usd: 9 }), { items: 5 });
  assert.deepEqual(addBudgets({ items: 1 }, { items: 2, usd: 1 }), { items: 3, usd: 1 });
});

test("remaining and overrun compare spend with the limit", () => {
  assert.deepEqual(remainingBudget({ items: 5, usd: 1 }, spend(2, 1.5)), { items: 3, usd: -0.5 });
  assert.deepEqual(overrunOf({ items: 5, usd: 1 }, spend(2, 1.5)), { measure: "usd", limit: 1, spent: 1.5 });
  assert.equal(overrunOf({ items: 5 }, spend(5)), undefined);
});

test("a nested frame draws from its caller: its limit is the smaller of its own and what the caller has left", () => {
  const root = rootFrame({ items: 10 });
  charge(root, spend(4));
  const nested = childFrame(root, { items: 8 }, {});
  assert.deepEqual(nested.limit, { items: 6 });
  charge(nested, spend(5));
  assert.deepEqual(root.spent, spend(9));
  assert.deepEqual(frameRemaining(nested), { items: 1 });
  assert.equal(frameOverrun(nested), undefined);
  charge(nested, spend(2));
  assert.deepEqual(frameOverrun(nested), { measure: "items", limit: 6, spent: 7 });
  assert.deepEqual(childFrame(root, undefined, {}).limit, { items: -1 });
  assert.deepEqual(childFrame(rootFrame({}), { usd: 1 }, { usd: 2 }).limit, { usd: 3 });
  assert.deepEqual(rootFrame({}).spent, noSpend);
});

test("budgets and spend read back from JSON, ignoring what is not a number", () => {
  assert.deepEqual(budgetFromJson({ items: 3, usd: "x" }), { items: 3 });
  assert.deepEqual(spendFromJson({ tokens: 7 }), { items: 0, usd: 0, tokens: 7, minutes: 0 });
});

test("an extension must be made of numbers of at least zero", () => {
  assert.deepEqual(budgetProblems({ items: 1, usd: 0 }), []);
  assert.deepEqual(budgetProblems({ items: -1, minutes: Number.NaN }), [
    "items must be a number of at least 0, but it is -1.",
    "minutes must be a number of at least 0, but it is NaN.",
  ]);
});
