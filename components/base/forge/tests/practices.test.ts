import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { reviewersPractices } from "../scripts/lib/practices.ts";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const table = [
  "| Id | Practice | Held by |",
  "|---|---|---|",
  "| P-01 | No comments in code. | check: lint rule `agentbay/no-comments` |",
].join("\n");

function withRow(row: string): string {
  return `${table}\n${row}\n`;
}

test("a row held by a tool alone is not the reviewer's", () => {
  assert.deepEqual(reviewersPractices(withRow("")), []);
});

test("of two rows, only the one held by review is the reviewer's", () => {
  const text = withRow("| P-03 | Problems are returned as values. | review |");
  assert.deepEqual(reviewersPractices(text), [{ id: "P-03", says: "Problems are returned as values." }]);
});

test("review in any part of Held by, and a planned check, make a row the reviewer's; plan and design do not", () => {
  const rows = [
    "| P-02 | The language's own practices. | check: compiler and lint for most; review for the rest |",
    "| P-12 | The same code lives in one place. | planned check: copy-paste detector |",
    "| P-36 | A module is named for what it does. | check planned: names of folders; review |",
    "| P-33 | A plan is broken into slices. | plan |",
    "| P-35 | Interfaces first. | design, plan |",
    "| P-32 | A step that needs no judgement is a script. | design, review |",
  ];
  const ids = reviewersPractices(`${table}\n${rows.join("\n")}\n`).map((practice) => practice.id);
  assert.deepEqual(ids, ["P-02", "P-12", "P-36", "P-32"]);
});

test("a practice under its own heading is read from its Held by line, words in brackets aside", () => {
  const text = [
    "## TS-01 The file must run with its types erased",
    "",
    "Held by: compiler (`erasableSyntaxOnly`, `review`). Source: official.",
    "",
    "## TS-04 Data from outside is parsed once, at the edge",
    "",
    "Held by: review. Source: ours.",
    "",
    "## TS-06 Index access may be missing",
    "",
    "Held by: the compiler for most (TS-08); review. Source: ours.",
    "",
  ].join("\n");
  assert.deepEqual(reviewersPractices(text), [
    { id: "TS-04", says: "Data from outside is parsed once, at the edge" },
    { id: "TS-06", says: "Index access may be missing" },
  ]);
});

test("the kit's practices files give the reviewer the rows review holds and none a tool alone holds", async () => {
  const framework = reviewersPractices(await readFile(`${kit}/framework/practices.md`, "utf8"));
  const typescript = reviewersPractices(await readFile(`${kit}/components/base/typescript/practices.md`, "utf8"));
  const ids = [...framework, ...typescript].map((practice) => practice.id);
  for (const held of ["P-03", "P-04", "P-12", "P-38", "TS-04", "TS-18", "TS-21", "TS-12"]) {
    assert.ok(ids.includes(held), held);
  }
  for (const tool of ["P-01", "P-08", "P-09", "P-33", "P-35", "TS-01", "TS-03", "TS-06", "TS-13"]) {
    assert.ok(!ids.includes(tool), tool);
  }
  assert.equal(new Set(ids).size, ids.length);
});
