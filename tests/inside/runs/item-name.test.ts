import assert from "node:assert/strict";
import { test } from "node:test";
import { itemPlaceWords } from "../../../bay/runs/item-name.ts";

test("an item without a name is named by its place, counted from the 1st as a person counts", () => {
  const said = [0, 1, 2, 3, 10, 11, 12, 20, 21, 22, 100, 110, 111].map((item) =>
    itemPlaceWords({ item, foreach: "slices" }),
  );
  assert.deepEqual(said, [
    "the 1st item of step slices",
    "the 2nd item of step slices",
    "the 3rd item of step slices",
    "the 4th item of step slices",
    "the 11th item of step slices",
    "the 12th item of step slices",
    "the 13th item of step slices",
    "the 21st item of step slices",
    "the 22nd item of step slices",
    "the 23rd item of step slices",
    "the 101st item of step slices",
    "the 111th item of step slices",
    "the 112th item of step slices",
  ]);
  assert.equal(itemPlaceWords({ item: 0, foreach: "slices", count: 1 }), "the 1st of 1 item of step slices");
  assert.equal(itemPlaceWords({ item: 2, foreach: "slices", count: 3 }), "the 3rd of 3 items of step slices");
});
