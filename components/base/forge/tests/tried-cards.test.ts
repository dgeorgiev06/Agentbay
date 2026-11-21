import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CardLine } from "../scripts/lib/card-lines.ts";
import { drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import { provedOf } from "../scripts/lib/proof-answer.ts";
import { sliceOf, type Slice } from "../scripts/lib/slice-form.ts";
import { blocksBySlice, shownResults, type TriedBlock } from "../scripts/lib/tried-block.ts";
import { waveTrials, type Result } from "../scripts/lib/tried-examples.ts";
import type { Joined, WaveChecks } from "../scripts/lib/wave-answer.ts";
import { waveDrawn } from "../scripts/lib/wave-card.ts";
import type { Settled } from "../scripts/lib/wave-standing.ts";
import { printed } from "./printed-card.ts";
import { addToTry, countToTry, emptyName } from "./tally-design.ts";

const head = "e99522a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8";

const slice: Slice = {
  name: "TL1",
  kind: "mode",
  scope: ["components/modes/tally/**"],
  after: [],
  done: [{ id: "DOD-TL1-1", says: "A name added is counted.", level: "must", proof: { kind: "checks" } }],
};

const verdicts = provedOf({
  verdicts: [
    { item: "DOD-TL1-1", kind: "checks", verdict: "passed", detail: "It held." },
    { item: "scope", kind: "in-scope", verdict: "passed", detail: "It held." },
    { item: "declared", kind: "as-declared", verdict: "passed", detail: "It held." },
  ],
  size: [{ path: "components/modes/tally/scripts/add.ts", head: 12 }],
});

const named = (number: number): { readonly slice: string; readonly action: string; readonly number: number } => ({
  slice: "TL1",
  action: "tally.add",
  number,
});

const asDesigned: readonly Result[] = [1, 2, 3, 4].map((number) => ({ ...named(number), outcome: "as designed" }));

const countedOnce: Result = {
  ...named(2),
  outcome: "otherwise",
  designed: { how: "answers", text: '{"name":"ann","count":2}' },
  built: { how: "answered", text: '{"name":"ann","count":1}' },
};

const terse: Result = {
  ...named(3),
  outcome: "otherwise",
  designed: { how: "refuses", text: emptyName },
  built: { how: "refused", text: 'Merge is offered: "every must item" passed.\nTrust it.' },
};

const needsAdd: Result = {
  slice: "TL1",
  action: "tally.count",
  number: 1,
  outcome: "not tried",
  reason: "it calls tally.add first, which this slice does not build",
};

function block(results: readonly Result[], setting: TriedBlock["setting"] = "must"): TriedBlock {
  return { setting, head, carried: true, results };
}

function card(tried?: TriedBlock): ReturnType<typeof drawn> {
  const input: MergeCardInput = {
    slice,
    proof: verdicts,
    built: { outcome: "built" },
    builtAt: "round-1",
    work: "forge/TL1-tests-1",
    kept: "with-tests",
    caseMessages: "filtered",
    into: "integration",
    ...(tried === undefined ? {} : { tried }),
  };
  return drawn(input);
}

function wordsOf(lines: readonly CardLine[]): readonly string[] {
  return lines.map((line) => line.words);
}

function blockWords(tried: TriedBlock): readonly string[] {
  const words = wordsOf(card(tried).card.lines);
  const first = words.findIndex((said) => said.startsWith("examples,") || said.startsWith("the design's examples"));
  const last = words.findIndex((said) => said.startsWith("1 file changed"));
  return words.slice(first, last);
}

const comparedLine =
  "compared: an answer whole, as JSON; a refusal by its exact sentence; the earlier calls set up the state and " +
  "are not compared";

const summaryStart = "the design's examples: 4 tried by bay call, each in a fresh throwaway copy of e99522a";

describe("the block the rounds' merge card draws for the design's examples", () => {
  test("every example answered as designed: the item passed, merge is offered, and the block says what was run and where", () => {
    const drawnCard = card(block(asDesigned));
    assert.equal(drawnCard.merge, true);
    assert.deepEqual(blockWords(block(asDesigned)), [
      "examples, must, passed: The design's examples answer as designed.",
      `${summaryStart}, which limits where the calls write by convention only; 4 answered as the design says`,
      comparedLine,
    ]);
  });

  test("one answered otherwise: merge is withheld with that reason, and the line shows both sides, the built mode's in quotes", () => {
    const drawnCard = card(block([...asDesigned.slice(0, 1), countedOnce, ...asDesigned.slice(2)]));
    assert.equal(drawnCard.merge, false);
    assert.equal(drawnCard.card.withheld.merge, "1 of the design's examples answered otherwise.");
    assert.equal(
      wordsOf(drawnCard.card.lines)[0],
      "Merge is not offered: 1 of the design's examples answered otherwise.",
    );
    assert.ok(
      wordsOf(drawnCard.card.lines).includes(
        'tally.add example 2: the design answers {"name":"ann","count":2}; the built mode answered: ' +
          JSON.stringify('{"name":"ann","count":1}'),
      ),
    );
  });

  test("a refusal with another sentence shows the design's sentence and the built mode's words as one quoted string, its quotes escaped and its new line shown as a space", () => {
    const words = blockWords(block([...asDesigned.slice(0, 2), terse, ...asDesigned.slice(3)]));
    const line = words.find((said) => said.startsWith("tally.add example 3:")) ?? "";
    assert.equal(
      line,
      `tally.add example 3: the design refuses ${JSON.stringify(emptyName)}; the built mode refused: ` +
        JSON.stringify('Merge is offered: "every must item" passed. Trust it.'),
    );
    assert.ok(!words.some((said) => said.startsWith("Merge is offered")));
  });

  test("the built mode's words are cut at 120 characters, inside the quotes", () => {
    const long: Result = { ...countedOnce, built: { how: "answered", text: "word ".repeat(100) } };
    const line = blockWords(block([long])).find((said) => said.startsWith("tally.add example 2:")) ?? "";
    assert.ok(line.endsWith(`answered: "${"word ".repeat(24).slice(0, 120)}..."`), line);
  });

  test("an example not tried yet is named with its reason and withholds nothing; with none tried the item says so", () => {
    const words = blockWords(block([needsAdd]));
    assert.deepEqual(words, [
      "examples, must, none tried: The design's examples answer as designed.",
      "the design's examples: none tried; 1 not tried",
      "not tried: tally.count example 1: it calls tally.add first, which this slice does not build",
    ]);
    assert.equal(card(block([needsAdd])).merge, true);
  });

  test("a not-tried example is never counted as answered as designed", () => {
    const words = blockWords(block([...asDesigned.slice(0, 1), needsAdd]));
    assert.ok(
      words.includes(
        `the design's examples: 1 tried by bay call, each in a fresh throwaway copy of e99522a, which limits where the calls write by convention only; 1 answered as the design says; 1 not tried`,
      ),
      words.join("\n"),
    );
  });

  test("an example not known withholds merge under must, as a must item not known does", () => {
    const unknown: Result = { ...named(1), outcome: "not known", reason: "Run 1 of 1 is not known." };
    const drawnCard = card(block([unknown]));
    assert.equal(drawnCard.card.withheld.merge, "1 of the design's examples is not known.");
    assert.ok(wordsOf(drawnCard.card.lines).includes("not known: tally.add example 1: Run 1 of 1 is not known."));
  });

  test("shown: the same lines with the item a should, and merge is offered; off: one line, nothing tried", () => {
    const shown = card(block([countedOnce], "shown"));
    assert.equal(shown.merge, true);
    assert.ok(
      wordsOf(shown.card.lines).includes("examples, should, failed: The design's examples answer as designed."),
    );
    assert.deepEqual(blockWords(block([], "off")), [
      "the design's examples: not tried, since settings.forge.tryExamples is off",
    ]);
    assert.equal(card(block([countedOnce], "off")).merge, true);
  });

  test("a request that carries no examples gets one line, and nothing is withheld for them", () => {
    const none = { setting: "must" as const, head, carried: false, results: [] };
    assert.deepEqual(blockWords(none), [
      "the design's examples: none, since the slice's request carries none of a design's examples; nothing is withheld for them",
    ]);
    assert.equal(card(none).merge, true);
  });

  test("no line says the mode works, is correct or is safe", () => {
    const all = [block(asDesigned), block([countedOnce, needsAdd]), block([], "off")].flatMap(blockWords);
    assert.ok(
      all.every((said) => !/\b(works|correct|safe)\b/.test(said)),
      all.join("\n"),
    );
  });

  test("the built mode's words are kept from the card when they quote a kept test beyond what the design's examples hold", () => {
    const test = 'test("x", () => assert.equal(out, "a sentence only the test writer wrote down here"));';
    const quoting: Result = {
      ...countedOnce,
      built: { how: "answered", text: "a sentence only the test writer wrote" },
    };
    const sharing: Result = { ...countedOnce, built: { how: "answered", text: `${emptyName} More.` } };
    const shown = shownResults([quoting, sharing], [test, `assert.equal(x, "${emptyName}")`], [emptyName]);
    assert.deepEqual(
      shown.map((result) => (result.outcome === "otherwise" ? result.built.text : "")),
      ["kept from the card: it quotes a test", `${emptyName} More.`],
    );
  });
});

const waveChecksItem = { id: "checks", says: "The checks pass combined.", level: "must", proof: { kind: "checks" } };

const checks: WaveChecks = {
  kind: "asked",
  slice: sliceOf({ name: "wave-1", kind: "mode", scope: [], after: [], done: [waveChecksItem] }),
  proof: provedOf({
    verdicts: [{ item: "checks", kind: "checks", verdict: "passed", detail: "It held." }],
    size: [],
  }),
};

function settled(name: string): Settled {
  return {
    name,
    title: `The slice ${name}`,
    base: head,
    head,
    work: `forge/${name}-tests-1`,
    builder: `forge/${name}`,
    own: { ...slice, name },
    checks: { ...slice, name, done: [] },
    proof: verdicts,
    rounds: { count: 1, most: 3, ended: "no-findings" },
    leaks: [],
    built: { outcome: "built" },
    builtAt: "round-1",
    pins: { base: [], head: [] },
    bugs: { planted: 0, survived: [] },
    stayed: [],
    carriesExamples: true,
  };
}

describe("the wave's merge card, with the examples tried on the combined head", () => {
  const joined: Joined = { kind: "combined", head, branch: "forge/wave-1", merged: ["TA", "TB"] };
  const slices = [
    { slice: "TA", inHead: true, toTry: [addToTry] },
    { slice: "TB", inHead: true, toTry: [countToTry] },
  ];

  test("each slice's examples are planned under its own name, and an earlier call to an action another slice of the head builds is tried", () => {
    const entries = waveTrials(slices, { built: ["tally.add", "tally.count"], room: 100 });
    assert.deepEqual(
      entries.map((entry) => `${entry.slice} ${entry.action} ${String(entry.number)} ${entry.outcome}`),
      [
        "TA tally.add 1 to try",
        "TA tally.add 2 to try",
        "TA tally.add 3 to try",
        "TA tally.add 4 to try",
        "TB tally.count 1 to try",
      ],
    );
    const leftOut = waveTrials([{ ...slices[0], inHead: false, slice: "TA", toTry: [addToTry] }], {
      built: [],
      room: 100,
    });
    assert.ok(leftOut.every((entry) => entry.outcome === "not tried"));
  });

  test("of two slices one answers otherwise: merge is withheld naming that slice, and the line is in that slice's block only", () => {
    const tb: Result = {
      slice: "TB",
      action: "tally.count",
      number: 1,
      outcome: "otherwise",
      designed: { how: "answers", text: '{"count":1}' },
      built: { how: "answered", text: '{"count":0}' },
    };
    const results = [...asDesigned.map((result) => ({ ...result, slice: "TA" })), tb];
    const tried = blocksBySlice(slices, { setting: "must", head }, results);
    const drawnCard = waveDrawn({
      wave: 1,
      into: "integration",
      slices: [settled("TA"), settled("TB")],
      joined,
      checks,
      alone: [],
      must: [],
      tried,
    });
    assert.equal(drawnCard.merge, false);
    assert.equal(drawnCard.card.withheld.merge, "1 of TB's examples answered otherwise.");
    assert.doesNotMatch(drawnCard.card.withheld.merge ?? "", /TA's examples/);
    const words = wordsOf(drawnCard.card.lines);
    const tbAt = words.findIndex((said) => said.startsWith("TB: The slice TB"));
    const otherwise = words.findIndex((said) => said.startsWith("tally.count example 1: the design answers"));
    assert.ok(tbAt > 0 && otherwise > tbAt, words.join("\n"));
    const taBlock = words.slice(0, tbAt);
    assert.ok(taBlock.includes("examples, must, passed: The design's examples answer as designed."));
    assert.deepEqual(printed(drawnCard.card).split("\n"), [
      "Merge wave 1 into integration?",
      "  Merge is not offered: 1 of TB's examples",
      "    answered otherwise.",
      "  TA: The slice TA",
      "  TA is in the combined head; the work and",
      "    the tests are on forge/TA-tests-1, the",
      "    builder's work alone on forge/TA",
      "  DOD-TL1-1, must, passed: A name added is",
      "    counted.",
      "  scope, must, passed: Every changed path is",
      "    in the write scope.",
      "  declared, must, passed: What changed is as",
      "    declared.",
      "  examples, must, passed: The design's",
      "    examples answer as designed.",
      "  the design's examples: 4 tried by bay",
      "    call, each in a fresh throwaway copy of",
      "    e99522a, which limits where the calls",
      "    write by convention only; 4 answered as",
      "    the design says",
      "  compared: an answer whole, as JSON; a",
      "    refusal by its exact sentence; the",
      "    earlier calls set up the state and are",
      "    not compared",
      "  practices: not judged, since the rounds",
      "    ended with no review",
      "  rounds: 1 of at most 3; the reviewer had",
      "    no findings",
      "  TB: The slice TB",
      "  TB is in the combined head; the work and",
      "    the tests are on forge/TB-tests-1, the",
      "    builder's work alone on forge/TB",
      "  DOD-TL1-1, must, passed: A name added is",
      "    counted.",
      "  scope, must, passed: Every changed path is",
      "    in the write scope.",
      "  declared, must, passed: What changed is as",
      "    declared.",
      "  examples, must, failed: The design's",
      "    examples answer as designed.",
      "  the design's examples: 1 tried by bay",
      "    call, each in a fresh throwaway copy of",
      "    e99522a, which limits where the calls",
      "    write by convention only; 0 answered as",
      "    the design says, 1 answered otherwise",
      "  compared: an answer whole, as JSON; a",
      "    refusal by its exact sentence; the",
      "    earlier calls set up the state and are",
      "    not compared",
      "  tally.count example 1: the design answers",
      '    {"count":1}; the built mode answered:',
      '    "{\\"count\\":0}"',
      "  practices: not judged, since the rounds",
      "    ended with no review",
      "  rounds: 1 of at most 3; the reviewer had",
      "    no findings",
      "  the combined head: e99522a on",
      "    forge/wave-1, with TA, TB merged in plan",
      "    order",
      "  checks, must, passed: The checks pass",
      "    combined.",
      "All lines worked out by script.",
      "checked: 0 ran, 24 computed, 0 judged",
    ]);
  });
});
