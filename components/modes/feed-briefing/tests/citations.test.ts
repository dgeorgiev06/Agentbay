import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { citationFeedback } from "../scripts/lib/citations.ts";
import { digestLimits } from "../scripts/lib/limits.ts";

const period = { since: "2026-11-01T00:00:00.000Z", until: "2026-11-15T00:00:00.000Z" };

const longExcerpt = "Two EU banks announce institutional ETH staking pilots through regulated custodians this week.";

const selection: Json = {
  period,
  focus: null,
  selectorChanged: false,
  more: false,
  limits: digestLimits,
  items: [
    { id: "fake:1", at: "2026-11-02T00:00:00.000Z", author: "a", labels: [], url: null, excerpt: longExcerpt },
    { id: "fake:2", at: "2026-11-03T00:00:00.000Z", author: "b", labels: [], url: null, excerpt: "Short one." },
  ],
};

function draft(themes: Json, extra: Readonly<Record<string, Json>> = {}): Json {
  return { period, selectorChanged: false, themes, notes: null, ...extra };
}

const fine = {
  title: "Banks pilot staking",
  summary: "Banks are piloting staking with custodians.",
  cites: ["fake:1"],
};

test("a draft whose every theme cites given items, within the limits, passes", () => {
  assert.deepEqual(citationFeedback(selection, draft([fine, { ...fine, cites: ["fake:1", "fake:2"] }])), []);
  assert.deepEqual(citationFeedback(selection, draft([])), []);
});

test("rule one: a theme that cites no item fails", () => {
  const feedback = citationFeedback(selection, draft([{ ...fine, cites: [] }]));
  assert.deepEqual(feedback, [
    'Theme 1 ("Banks pilot staking") cites no item; every theme rests on at least one item id from the input.',
  ]);
});

test("rule two: a theme that cites an id it was not given fails, naming the id", () => {
  const feedback = citationFeedback(selection, draft([fine, { ...fine, title: "Other", cites: ["fake:2", "fake:9"] }]));
  assert.deepEqual(feedback, [
    'Theme 2 ("Other") cites fake:9, which is not one of the items you were given; cite only ids from the input.',
  ]);
});

test("the word limits hold for titles, summaries and notes, and the number of themes is capped", () => {
  const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");
  assert.deepEqual(citationFeedback(selection, draft([{ ...fine, title: words(10), summary: words(60) }])), []);
  const over = citationFeedback(
    selection,
    draft([{ ...fine, title: words(11), summary: words(61) }], { notes: words(81) }),
  );
  assert.equal(over.length, 3);
  const many = citationFeedback(selection, draft(Array.from({ length: 8 }, () => fine)));
  assert.deepEqual(many, ["The digest has 8 themes; write at most 7."]);
});

test("a summary that copies a long excerpt fails; a short excerpt quoted whole does not", () => {
  const copied = citationFeedback(selection, draft([{ ...fine, summary: `As posted: ${longExcerpt.toUpperCase()}` }]));
  assert.deepEqual(copied, [
    'Theme 1 ("Banks pilot staking") copies the text of fake:1; say what it says in your own words.',
  ]);
  assert.deepEqual(
    citationFeedback(selection, draft([{ ...fine, summary: "Short one. And more.", cites: ["fake:2"] }])),
    [],
  );
});

test("period and selectorChanged must be copied from the input", () => {
  const moved = citationFeedback(
    selection,
    draft([fine], { period: { ...period, since: "2026-10-01T00:00:00.000Z" } }),
  );
  assert.equal(moved.length, 1);
  assert.match(moved[0] ?? "", /^Copy period exactly from the input/);
  assert.deepEqual(citationFeedback(selection, draft([fine], { selectorChanged: true })), [
    "Copy selectorChanged exactly from the input: false.",
  ]);
});
