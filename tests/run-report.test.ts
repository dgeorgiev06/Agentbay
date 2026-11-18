import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldOf } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { runResult } from "../bay/run-report.ts";
import type { Run } from "../bay/runs/runs.ts";

const layout = layoutOf({ kit: "/kit", project: "/project" });

function endedRun(state: Run["state"]): Run {
  return {
    id: "r1",
    target: { kind: "action", mode: "notes", name: "save" },
    state,
    spent: { items: 0, usd: 0, tokens: 0, minutes: 0 },
    createdAt: "2026-11-15T09:00:00.000Z",
    updatedAt: "2026-11-15T09:00:00.000Z",
    steps: [],
    events: [],
  };
}

test("the run report exits 1 for a failed or an undone run and 0 for a done one", () => {
  const undo = { undone: [{ stepKey: "0", action: "store.put" }], failed: [], noUndo: [], deleteNotUndone: [] };
  const undone = runResult(layout, { ok: true, value: endedRun({ status: "undone", reason: "it failed", undo }) });
  assert.equal(undone.exitCode, 1);
  assert.equal(undone.json.ok, false);
  assert.equal(undone.text, "run r1 (action notes.save): undone\nreason: it failed");
  const failed = runResult(layout, { ok: true, value: endedRun({ status: "failed", reason: "it failed" }) });
  assert.equal(failed.exitCode, 1);
  const done = runResult(layout, { ok: true, value: endedRun({ status: "done", output: null }) });
  assert.equal(done.exitCode, 0);
});

type Approval = Extract<
  Extract<Run["state"], { readonly status: "waiting" }>["waiting"],
  { readonly reason: "approval" }
>;

type ShownCard = NonNullable<Approval["card"]>;

function waitingRun(waiting: Approval): Run {
  return {
    ...endedRun({ status: "waiting", waiting }),
    target: { kind: "workflow", mode: "forge", name: "workflows/merge.yaml" },
  };
}

function printed(waiting: Approval): string {
  return runResult(layout, { ok: true, value: waitingRun(waiting) }).text;
}

function cardLinesOf(text: string): readonly string[] {
  return text.split("\n").slice(1, -1);
}

const leaveSentence =
  "The step 0 of action go asked to run the listed command leave with [] in ., but the owner does not trust " +
  "the list of mode command-prober, so none of its commands or throwaway folders is granted. The owner reads " +
  "the list and decides with: bay approve --trust command-prober.";

const reviewSkill = { mode: "forge", skill: "skills/review", tier: "deep" } as const;

const mergeLines: ShownCard["lines"] = [
  { mark: "computed", words: "round 1 of 2, 11 files changed", source: { step: "offer" } },
  { mark: "computed", words: "checks: 5 of 5 passed", source: { step: "offer" } },
  { mark: "ran", words: "# pass 1374", source: { step: "check", command: "test" } },
  { mark: "ran", words: "# fail 0", source: { step: "check", command: "test" } },
  { mark: "computed", words: "new tests failed on the base, pass on the head: 2 files", source: { step: "offer" } },
  { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "offer" } },
  { mark: "computed", words: "as declared: 11 of 11 files", source: { step: "offer" } },
  { mark: "computed", words: "bugs caught: 10 of 10", source: { step: "offer" } },
  { mark: "computed", words: "same output: 29 of 29; 2 differ as the slice says", source: { step: "offer" } },
  { mark: "ran", words: "framework/feature-map-debt.yaml:26", source: { step: "check", command: "debt" } },
  { mark: "computed", words: "known breaks: 26, before 26", source: { step: "offer" } },
  { mark: "ran", words: leaveSentence, source: { step: "real", command: "bay" } },
  {
    mark: "judged",
    words: "the sentences tell the owner what to do; the tests assert what each item says",
    source: { step: "review" },
    skills: [reviewSkill],
  },
  { mark: "computed", words: "size: bay/ +110 -3, tests +397 -4", source: { step: "offer" } },
];

const mergeHash = "e5cbecc3dd2d44925914884403ddf5178d79f3c80e82abf015331d177dfef2d9";

const mergeChoices: NonNullable<Approval["choices"]> = [
  { name: "merge", status: "offered", does: "Merge into feat/0022-agentbay5" },
  { name: "send-back", status: "offered", does: "Round 2, a fresh builder" },
  { name: "keep", status: "offered", does: "Stop; forge/tr2 stays" },
  { name: "discard", status: "offered", does: "Stop; forge/tr2 is removed" },
];

function mergeCard(changes: Partial<Approval> = {}): Approval {
  const lines = mergeLines.map(({ mark, words, source }) => ({ mark, words, source }));
  return {
    reason: "approval",
    stepKey: "card",
    question: "Merge this slice?",
    hash: mergeHash,
    content: { title: "Merge TR2 into feat/0022-agentbay5?", lines },
    choices: mergeChoices,
    card: {
      title: "Merge TR2 into feat/0022-agentbay5?",
      lines: mergeLines,
      counted: { ran: 4, computed: 9, judged: 1 },
    },
    ...changes,
  };
}

function plainApproval(content: Approval["content"]): Approval {
  return { reason: "approval", stepKey: "card", question: "Merge this slice?", hash: mergeHash, content };
}

function cardWith(lines: ShownCard["lines"], changes: Partial<Approval> = {}): Approval {
  const counted = {
    ran: lines.filter((line) => line.mark === "ran").length,
    computed: lines.filter((line) => line.mark === "computed").length,
    judged: lines.filter((line) => line.mark === "judged").length,
  };
  return mergeCard({ card: { title: "Merge it?", lines, counted }, ...changes });
}

const mergePrinted = `run r1 (workflow forge:workflows/merge.yaml): waiting for approval at card
Merge TR2 into feat/0022-agentbay5?
computed round 1 of 2, 11 files changed
computed checks: 5 of 5 passed
ran      # pass 1374
ran      # fail 0
computed new tests failed on the base, pass
computed   on the head: 2 files
computed in scope: 11 of 11 paths
computed as declared: 11 of 11 files
computed bugs caught: 10 of 10
computed same output: 29 of 29; 2 differ as
computed   the slice says
ran      framework/feature-map-debt.yaml:26
computed known breaks: 26, before 26
ran      The step 0 of action go asked to
ran        run the listed command leave with
ran        [] in ., but the owner does not
ran        trust the list of mode
ran        command-prober, so none of its
ran        commands or throwaway folders is
ran        granted. The owner reads the list
ran        and decides with: bay approve
ran        --trust command-prober.
judged   the sentences tell the owner what
judged     to do; the tests assert what each
judged     item says
judged    by forge skills/review, tier deep
computed size: bay/ +110 -3, tests +397 -4
Choose one:
  merge      Merge into feat/0022-agentbay5
  send-back  Round 2, a fresh builder
  keep       Stop; forge/tr2 stays
  discard    Stop; forge/tr2 is removed
checked: 4 ran, 9 computed, 1 judged
hash e5cbecc3dd2d
decide with: bay approve r1 card --choice <name> --hash ${mergeHash}`;

test("a waiting approval with a card prints the card, its choices, the kernel's counts and the command to decide", () => {
  assert.equal(printed(mergeCard()), mergePrinted);
});

test("a line of 200 characters is wrapped to 44 columns with every word in order, and a long word is never cut", () => {
  const words = Array.from({ length: 40 }, (_, index) => `w${String(index).padStart(3, "0")}`).join(" ");
  const long = `${"x".repeat(50)}${"y".repeat(30)}`;
  assert.equal(words.length, 199);
  const text = printed(
    cardWith([
      { mark: "computed", words, source: { step: "offer" } },
      { mark: "ran", words: `see ${long} there`, source: { step: "check", command: "test" } },
    ]),
  );
  const lines = cardLinesOf(text);
  assert.deepEqual(
    lines.filter((line) => Array.from(line).length > 44),
    [],
  );
  const computed = lines.filter((line) => line.startsWith("computed ")).map((line) => line.slice(9).trim());
  assert.equal(computed.join(" "), words);
  const ran = lines.filter((line) => line.startsWith("ran ")).map((line) => line.slice(9).trim());
  assert.deepEqual(ran, [
    "see",
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "xxxxxxxxxxxxxxxxxyyyyyyyyyyyyyyyy",
    "yyyyyyyyyyyyyy there",
  ]);
  assert.equal(
    ran
      .slice(1)
      .join("")
      .replace(/ there$/, ""),
    long,
  );
});

test("a withheld choice is printed as not offered, with its sentence and its reason wrapped", () => {
  const choices: NonNullable<Approval["choices"]> = [
    {
      name: "merge",
      status: "withheld",
      does: "Merge into feat/0022-agentbay5",
      reason: "1 must item is inconclusive, and 2 should items failed on the head.",
    },
    { name: "keep", status: "offered", does: "Stop; forge/tr2 stays" },
  ];
  const lines = printed(mergeCard({ choices })).split("\n");
  const from = lines.indexOf("Choose one:");
  assert.deepEqual(lines.slice(from, from + 6), [
    "Choose one:",
    "  merge  Merge into feat/0022-agentbay5",
    "         not offered: 1 must item is",
    "         inconclusive, and 2 should items",
    "         failed on the head.",
    "  keep   Stop; forge/tr2 stays",
  ]);
});

test("characters that could redraw a terminal are shown harmlessly in the title, words, a sentence and a reason", () => {
  const clear = "\u001b[2J";
  const waiting = mergeCard({
    card: {
      title: `Merge ${clear}it?`,
      lines: [{ mark: "computed", words: `in scope${clear}‮: 11`, source: { step: "offer" } }],
      counted: { ran: 0, computed: 1, judged: 0 },
    },
    choices: [
      { name: "merge", status: "withheld", does: `Merge${clear}`, reason: `none ran\u0007` },
      { name: "keep", status: "offered", does: `Stop\r${clear}` },
    ],
  });
  const text = printed(waiting);
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(text), false);
  assert.deepEqual(cardLinesOf(text), [
    "Merge \\u001b[2Jit?",
    "computed in scope\\u001b[2J\\u202e: 11",
    "Choose one:",
    "  merge  Merge\\u001b[2J",
    "         not offered: none ran\\u0007",
    "  keep   Stop\\u000d\\u001b[2J",
    "checked: 0 ran, 1 computed, 0 judged",
    "hash e5cbecc3dd2d",
  ]);
});

test("the short hash on the card is the start of the full hash the command to decide carries", () => {
  const lines = printed(mergeCard()).split("\n");
  const short = lines.find((line) => line.startsWith("hash "))?.slice("hash ".length) ?? "";
  const full = /--hash ([0-9a-f]+)$/.exec(lines.at(-1) ?? "")?.[1] ?? "";
  assert.equal(short, "e5cbecc3dd2d");
  assert.equal(full, mergeHash);
  assert.ok(full.startsWith(short));
});

test("a judged line says the skill and tier the kernel gave, names no model, and a line given none says nothing", () => {
  const two = [reviewSkill, { mode: "forge", skill: "skills/plan", tier: "fast" } as const];
  const lines = cardLinesOf(
    printed(
      cardWith([
        { mark: "judged", words: "the design is sound", source: { step: "review" }, skills: two },
        { mark: "judged", words: "the tests assert it", source: { step: "review" }, skills: two },
        { mark: "computed", words: "in scope: 3 of 3", source: { step: "offer" } },
        { mark: "judged", words: "the plan holds", source: { step: "plan" }, skills: [] },
      ]),
    ),
  );
  assert.deepEqual(lines.slice(0, 7), [
    "Merge it?",
    "judged   the design is sound",
    "judged   the tests assert it",
    "judged    by forge skills/review, tier deep;",
    "judged      forge skills/plan, tier fast",
    "computed in scope: 3 of 3",
    "judged   the plan holds",
  ]);
  assert.equal(lines[7], "Choose one:");
});

test("only the card is printed: what a script handed over beside it is not", () => {
  const waiting = mergeCard({ content: { title: "raw-only-marker", lines: [] } });
  assert.ok(!printed(waiting).includes("raw-only-marker"));
});

test("an approval with choices and no card prints its content as before, then the choices", () => {
  const noCard = { ...plainApproval({ summary: "11 of 11 items passed" }), choices: mergeChoices };
  assert.equal(
    printed(noCard),
    [
      "run r1 (workflow forge:workflows/merge.yaml): waiting for approval at card",
      "approval: Merge this slice?",
      `shown content (hash ${mergeHash}):`,
      "{",
      '  "summary": "11 of 11 items passed"',
      "}",
      "Choose one:",
      "  merge      Merge into feat/0022-agentbay5",
      "  send-back  Round 2, a fresh builder",
      "  keep       Stop; forge/tr2 stays",
      "  discard    Stop; forge/tr2 is removed",
      `decide with: bay approve r1 card --choice <name> --hash ${mergeHash}`,
    ].join("\n"),
  );
});

test("an approval with neither choices nor a card prints exactly as before", () => {
  assert.equal(
    printed(plainApproval({ greeting: "Hello, Cy" })),
    [
      "run r1 (workflow forge:workflows/merge.yaml): waiting for approval at card",
      "approval: Merge this slice?",
      `shown content (hash ${mergeHash}):`,
      "{",
      '  "greeting": "Hello, Cy"',
      "}",
      `decide with: bay approve r1 card --hash ${mergeHash} [--reject]`,
    ].join("\n"),
  );
});

test("the JSON form gives the card, the choices and the hash as the runs entry returns them, with no drawing", () => {
  const waiting = mergeCard();
  const result = runResult(layout, { ok: true, value: waitingRun(waiting) });
  assert.deepEqual(fieldOf(result.json.run ?? null, "waiting"), {
    reason: "approval",
    stepKey: "card",
    question: "Merge this slice?",
    hash: mergeHash,
    content: waiting.content,
    choices: mergeChoices,
    card: waiting.card,
  });
});

test("a word that fits its row is never split, and one longer than its row is split with no space inside it", () => {
  const lines = cardLinesOf(
    printed(
      cardWith([
        { mark: "computed", words: "a".repeat(34), source: { step: "offer" } },
        { mark: "computed", words: "b".repeat(36), source: { step: "offer" } },
      ]),
    ),
  );
  assert.deepEqual(lines.slice(0, 4), [
    "Merge it?",
    `computed ${"a".repeat(34)}`,
    `computed ${"b".repeat(35)}`,
    "computed   b",
  ]);
});
