import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../bay/contracts.ts";
import { storedCardOf } from "../../../bay/runs/card.ts";

const malformed = "kernel.db holds an approval step whose detail has no valid card.";

function storedWith(inItem: Readonly<Record<string, Json>>): Json {
  const skills = [{ mode: "notes", skill: "skills/draft", tier: "balanced" }];
  const line = { mark: "judged", words: "it holds", source: { step: "write", item: 1 }, skills, foreach: "each" };
  return { title: "Merge wave 1?", lines: [{ ...line, ...inItem }] };
}

test("a stored count of items is read back only as a whole number past the line's item", () => {
  assert.equal(storedCardOf(storedWith({ itemCount: 2 }))?.lines[0]?.itemCount, 2);
  for (const itemCount of [2.5, 1, 0, -3, "2", null, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => storedCardOf(storedWith({ itemCount })), { message: malformed }, String(itemCount));
  }
});

test("a stored name is read back only with an id of text, a title of text if any, and nothing else", () => {
  const kept = { id: "TD1", title: "The td1 mode" };
  assert.deepEqual(storedCardOf(storedWith({ itemName: kept }))?.lines[0]?.itemName, kept);
  const refused: readonly Json[] = [
    { id: "TD1", title: 5 },
    { id: "TD1", title: null },
    { id: "TD1", title: { text: "The td1 mode" } },
    { id: 7 },
    { title: "The td1 mode" },
    { id: "TD1", says: "more" },
    "TD1",
    ["TD1"],
    null,
  ];
  for (const itemName of refused) {
    assert.throws(() => storedCardOf(storedWith({ itemName })), { message: malformed }, JSON.stringify(itemName));
  }
});
