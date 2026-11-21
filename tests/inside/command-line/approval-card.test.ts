import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalLines } from "../../../bay/approval-card.ts";

type Approval = Parameters<typeof approvalLines>[0];

type Line = NonNullable<Approval["card"]>["lines"][number];

type Named = { readonly itemCount?: number; readonly itemName?: { readonly id: string; readonly title?: string } };

const skills = [{ mode: "forge", skill: "skills/review", tier: "deep" as const }];

function judged(words: string, item: number, named: Named): Line {
  return { mark: "judged", words, source: { step: "review-1", item }, skills, foreach: "slices", ...named };
}

function flowing(lines: readonly Line[]): string {
  const approval: Approval = {
    reason: "approval",
    stepKey: "card",
    question: "Merge this wave?",
    hash: "0123456789ab",
    content: null,
    card: { title: "Merge wave 1?", lines, counted: { ran: 0, computed: 0, judged: lines.length } },
  };
  return approvalLines(approval)
    .map((row) => row.replace(/^judged\s+/, ""))
    .join(" ")
    .replace(/\s+/g, " ");
}

test("the row under a judged line names its item by the name the kernel read, title in parentheses", () => {
  const said = flowing([
    judged("no finding remains", 0, { itemCount: 2, itemName: { id: "TD1", title: "The td1 mode counts" } }),
    judged("the second holds", 1, { itemCount: 2, itemName: { id: "TD2" } }),
  ]);
  assert.ok(said.includes("by forge skills/review, tier deep, for TD1 (The td1 mode counts)"), said);
  assert.ok(said.includes("by forge skills/review, tier deep, for TD2 checked:"), said);
  assert.ok(!said.includes("item 0") && !said.includes("item 1"), said);
});

test("without a name the row names the item by its place, with its count when the card kept one", () => {
  const said = flowing([judged("no finding remains", 0, { itemCount: 3 }), judged("the second holds", 1, {})]);
  assert.ok(said.includes("by forge skills/review, tier deep, for the 1st of 3 items of step slices"), said);
  assert.ok(said.includes("by forge skills/review, tier deep, for the 2nd item of step slices"), said);
});

test("an item without a name is named by its place, counted from the 1st as a person counts", () => {
  const items = [0, 1, 2, 3, 10, 11, 12, 20, 21, 22, 100, 110, 111];
  const said = flowing(items.map((item) => judged(`line ${String(item)}`, item, {})));
  const places = [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "23rd",
    "101st",
    "111th",
    "112th",
  ];
  for (const [index, item] of items.entries()) {
    const place = `line ${String(item)} by forge skills/review, tier deep, for the ${places[index] ?? ""} item of step`;
    assert.ok(said.includes(place), said);
  }
  const one = flowing([judged("alone", 0, { itemCount: 1 })]);
  assert.ok(one.includes("for the 1st of 1 item of step slices"), one);
});
