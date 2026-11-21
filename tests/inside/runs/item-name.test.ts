import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../bay/contracts.ts";
import { failedWith, succeededWith, unplacedProblem } from "../../../bay/outcome.ts";
import { isItemName, itemNameOf } from "../../../bay/runs/item-name.ts";

const declared = { id: "$item.id", title: "$item.title" };

function nameOf(id: Json | undefined, title?: Json): ReturnType<typeof itemNameOf> {
  const values = new Map<string, Json | undefined>([
    ["$item.id", id],
    ["$item.title", title],
  ]);
  return itemNameOf(declared, (reference) => {
    const value = values.get(reference);
    return value === undefined ? failedWith([unplacedProblem("nothing there")]) : succeededWith(value);
  });
}

test("an id that reads anything but text or a finite number names nothing, so the item is named by its place", () => {
  for (const id of [true, false, null, { name: "TD1" }, ["TD1"], undefined]) {
    assert.equal(nameOf(id, "A title"), undefined, JSON.stringify(id));
  }
  assert.deepEqual(nameOf(7, "A title"), { id: "7", title: "A title" });
});

test("a title that reads anything but text or a finite number leaves the id alone", () => {
  for (const title of [true, null, { text: "A title" }, undefined]) {
    assert.deepEqual(nameOf("TD1", title), { id: "TD1" }, JSON.stringify(title));
  }
});

test("an id or a title that is blank once cleaned names nothing", () => {
  for (const blank of ["", "   ", "\n\t", "​‮", "   "]) {
    assert.equal(nameOf(blank, "A title"), undefined, JSON.stringify(blank));
    assert.deepEqual(nameOf("TD1", blank), { id: "TD1" }, JSON.stringify(blank));
  }
});

test("format characters such as a bidi override or a zero-width space become spaces in the id and the title", () => {
  assert.deepEqual(nameOf("TD‮1​", "The​td1 ‮mode⁦"), { id: "TD 1", title: "The td1 mode" });
});

test("a stored name stands only as the kernel would have written it", () => {
  const kept = [
    { id: "TD1" },
    { id: "x".repeat(40) },
    { id: "TD1", title: "y".repeat(80) },
    { id: "TD1", title: `${"y".repeat(79)}…` },
    { id: "TD1 [fake]", title: "The td1 mode" },
  ];
  for (const name of kept) {
    assert.equal(isItemName(name), true, JSON.stringify(name));
  }
  const refused = [
    { id: "" },
    { id: "x".repeat(41) },
    { id: "TD1 (fake)" },
    { id: "TD‮1" },
    { id: "TD1", title: "" },
    { id: "TD1", title: "y".repeat(81) },
    { id: "TD1", title: "The td1 (mode)" },
    { id: "TD1", title: "The​td1 mode" },
    { id: "TD1", title: "The td1\nmode" },
    { id: "TD1", title: " The td1 mode" },
  ];
  for (const name of refused) {
    assert.equal(isItemName(name), false, JSON.stringify(name));
  }
});
