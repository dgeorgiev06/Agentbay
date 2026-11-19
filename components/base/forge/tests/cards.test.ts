import assert from "node:assert/strict";
import { test } from "node:test";
import {
  drawn,
  startCard,
  type Built,
  type Drawn,
  type MergeCardInput,
  type Missing,
  type Slice,
  type Verdict,
} from "../scripts/lib/cards.ts";

type VerdictName = Verdict["verdict"];

const notBuilt = (kind: string): string =>
  `The kind ${kind} is not built in this version of the proof mode, so nothing is known.`;

const tr2: Slice = {
  name: "TR2",
  kind: "capability",
  scope: [
    "bay/broker/**",
    "tests/broker-list-trust.test.ts",
    "tests/cli-trust-at-use.test.ts",
    "tests/script-commands.test.ts",
    "tests/shared-tests-in-a-project.test.ts",
    "tests/system-fixture.ts",
    "framework/features.yaml",
  ],
  after: [{ slice: "TR1", because: "ModeGrants.listTrust and readTrustRecord, which the broker reads" }],
  done: [
    {
      id: "DOD-TR2-1",
      says: "Each state refuses with its sentence",
      level: "must",
      proof: { kind: "fails-first", tests: ["tests/broker-list-trust.test.ts"] },
    },
    { id: "DOD-TR2-1b", says: "the sentences say what the owner does", level: "must" },
    {
      id: "DOD-TR2-2",
      says: "One function decides",
      level: "must",
      proof: { kind: "count", pattern: "listTrust.state", paths: ["bay/broker"], most: 2 },
    },
    {
      id: "DOD-TR2-3",
      says: "A run is refused",
      level: "must",
      proof: { kind: "fails-first", tests: ["tests/broker-list-trust.test.ts"] },
    },
    {
      id: "DOD-TR2-4",
      says: "bay call runs it",
      level: "must",
      proof: { kind: "fails-first", tests: ["tests/cli-trust-at-use.test.ts"] },
    },
    {
      id: "DOD-TR2-5",
      says: "Nothing changes",
      level: "must",
      proof: { kind: "same-output", differ: ["grants-check"] },
    },
    { id: "DOD-TR2-6a", says: "Neither debt list grows", level: "must", proof: { kind: "count", use: "debt" } },
    { id: "DOD-TR2-6b", says: "the copy-paste count does not rise", level: "must" },
    { id: "DOD-TR2-7", says: "Every injected bug is caught", level: "must", proof: { kind: "bugs-caught" } },
    { id: "DOD-TR2-8", says: "The checks and the tests pass", level: "must", proof: { kind: "checks" } },
  ],
};

const tr2Title = "The broker says why a list is not in force, and reads the record again before each command";

const failsFirstPassed = "The named tests failed on the base with them laid over it, and pass on the head.";

const tr2Verdicts: readonly Verdict[] = [
  { item: "DOD-TR2-1", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
  { item: "DOD-TR2-2", kind: "count", verdict: "inconclusive", reason: notBuilt("count") },
  { item: "DOD-TR2-3", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
  { item: "DOD-TR2-4", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
  { item: "DOD-TR2-5", kind: "same-output", verdict: "inconclusive", reason: notBuilt("same-output") },
  { item: "DOD-TR2-6a", kind: "count", verdict: "inconclusive", reason: notBuilt("count") },
  { item: "DOD-TR2-7", kind: "bugs-caught", verdict: "inconclusive", reason: notBuilt("bugs-caught") },
  {
    item: "DOD-TR2-8",
    kind: "checks",
    verdict: "passed",
    detail: "Every check passed (typecheck, lint, format:check, deadcode), and so did the test run: 1374 tests.",
  },
  { item: "scope", kind: "in-scope", verdict: "inconclusive", reason: notBuilt("in-scope") },
  { item: "declared", kind: "as-declared", verdict: "inconclusive", reason: notBuilt("as-declared") },
];

const tr2Size = [
  { path: "bay/broker/command-operations.ts", base: 180, head: 200 },
  { path: "bay/broker/file-operations.ts", base: 160, head: 170 },
  { path: "bay/broker/list-in-force.ts", head: 60 },
  { path: "bay/broker/rule.ts", base: 170, head: 182 },
  { path: "bay/broker/step-broker.ts", base: 90, head: 95 },
  { path: "tests/broker-list-trust.test.ts", head: 300 },
  { path: "tests/cli-trust-at-use.test.ts", head: 80 },
  { path: "tests/script-commands.test.ts", base: 400, head: 405 },
  { path: "tests/shared-tests-in-a-project.test.ts", base: 120, head: 123 },
  { path: "tests/system-fixture.ts", base: 200, head: 205 },
  { path: "framework/features.yaml", base: 300, head: 301 },
];

const tr2Judgement = [
  { id: "DOD-TR2-1b", says: "the sentences say what the owner does", level: "must" as const },
  { id: "DOD-TR2-6b", says: "the copy-paste count does not rise", level: "must" as const },
];

const built: Built = { outcome: "built" };

const tr2Merge: MergeCardInput = {
  slice: tr2,
  proof: { verdicts: tr2Verdicts, judgement: tr2Judgement, size: tr2Size },
  built,
  work: "forge/wip/TR2/1",
  kept: "set-aside",
  into: "feat/0022-agentbay5",
};

const sendBackWithheld = "no round runs after the card.";

const discardWithheld = "discarding comes with slice WD1.";

function computed(step: "slice" | "prove" | "draw", words: string): Drawn["card"]["lines"][number] {
  return { mark: "computed", words, source: { step } };
}

function fromSlice(words: readonly string[]): readonly Drawn["card"]["lines"][number][] {
  return words.map((said) => computed("slice", said));
}

const tr2Bugs = ["the record is not read again"];

test("card 1 for TR2 shows every item, each line computed from the step slice", () => {
  assert.deepEqual(startCard({ slice: tr2, title: tr2Title, base: "c7f0d13", bugs: tr2Bugs }), {
    title: "Build slice TR2?",
    lines: fromSlice([
      "The broker says why a list is not",
      "in force, and reads the record",
      "again before each command",
      "kind capability; base c7f0d13",
      "scope: bay/broker/** and 6 more",
      "paths",
      "after TR1: ModeGrants.listTrust and",
      "readTrustRecord, which the broker",
      "reads",
      "DOD-TR2-1, must: Each state refuses",
      "with its sentence",
      "held by: a test fails first",
      "tests:",
      "tests/broker-list-trust.test.ts",
      "DOD-TR2-1b, must: the sentences say",
      "what the owner does",
      "held by: your judgement",
      "DOD-TR2-2, must: One function",
      "decides",
      "held by: a count",
      'lines with "listTrust.state" in',
      "bay/broker: at most 2",
      "DOD-TR2-3, must: A run is refused",
      "held by: a test fails first",
      "tests:",
      "tests/broker-list-trust.test.ts",
      "DOD-TR2-4, must: bay call runs it",
      "held by: a test fails first",
      "tests:",
      "tests/cli-trust-at-use.test.ts",
      "DOD-TR2-5, must: Nothing changes",
      "held by: same output",
      "compares the settings' commands;",
      "grants-check must differ",
      "DOD-TR2-6a, must: Neither debt list",
      "grows",
      "held by: a count",
      "the settings' count debt: no rise",
      "DOD-TR2-6b, must: the copy-paste",
      "count does not rise",
      "held by: your judgement",
      "DOD-TR2-7, must: Every injected bug",
      "is caught",
      "held by: bugs caught",
      "injects the bugs named at the end",
      "DOD-TR2-8, must: The checks and the",
      "tests pass",
      "held by: checks",
      "1 bug to inject: the record is not",
      "read again",
    ]),
  });
});

const everyKind: Slice = {
  name: "K1",
  kind: "mode",
  scope: ["components/base/forge/**"],
  after: [],
  done: [
    { id: "K1-1", says: "The checks pass.", level: "must", proof: { kind: "checks" } },
    {
      id: "K1-2",
      says: "The card test fails first.",
      level: "must",
      proof: { kind: "fails-first", tests: ["components/base/forge/tests/cards.test.ts", "tests/a.test.ts"] },
    },
    { id: "K1-3", says: "Each bug is caught.", level: "should", proof: { kind: "bugs-caught" } },
    { id: "K1-4", says: "Nothing else changes.", level: "should", proof: { kind: "same-output", differ: [] } },
    {
      id: "K1-5",
      says: "No new TODO.",
      level: "must",
      proof: { kind: "count", pattern: "TODO", paths: ["bay", "tests"], most: 0 },
    },
    {
      id: "K1-6",
      says: "No more casts.",
      level: "must",
      proof: { kind: "count", pattern: "any", paths: ["bay"], noRise: true },
    },
    { id: "K1-7", says: "The debt does not grow.", level: "must", proof: { kind: "count", use: "debt" } },
    {
      id: "K1-8",
      says: "The kit checks itself.",
      level: "should",
      proof: { kind: "real-thing", runs: [{ bay: ["check"] }, { bay: ["actions", "--json"] }] },
    },
    { id: "K1-9", says: "It reads well.", level: "should" },
  ],
};

const everyKindBugs = ["the card drops an item", "a should reads must"];

test("card 1 for a slice with one item of every kind says how each is held and what is run or counted", () => {
  assert.deepEqual(
    startCard({ slice: everyKind, title: "Every kind", base: "main", bugs: everyKindBugs }).lines,
    fromSlice([
      "Every kind",
      "kind mode; base main",
      "scope: components/base/forge/**",
      "after no other slice",
      "K1-1, must: The checks pass.",
      "held by: checks",
      "K1-2, must: The card test fails",
      "first.",
      "held by: a test fails first",
      "tests: components/base/forge/tests/",
      "cards.test.ts, tests/a.test.ts",
      "K1-3, should: Each bug is caught.",
      "held by: bugs caught",
      "injects the bugs named at the end",
      "K1-4, should: Nothing else changes.",
      "held by: same output",
      "compares the settings' commands",
      "K1-5, must: No new TODO.",
      "held by: a count",
      'lines with "TODO" in bay, tests: at',
      "most 0",
      "K1-6, must: No more casts.",
      "held by: a count",
      'lines with "any" in bay: no rise',
      "K1-7, must: The debt does not grow.",
      "held by: a count",
      "the settings' count debt: no rise",
      "K1-8, should: The kit checks",
      "itself.",
      "held by: the real thing",
      "2 runs: bay check, bay actions",
      "K1-9, should: It reads well.",
      "held by: your judgement",
      "2 bugs to inject: the card drops an",
      "item; a should reads must",
    ]),
  );
});

test("card 1 with no bugs given says so for a bugs-caught item and has no line of bugs", () => {
  const slice: Slice = { ...everyKind, done: everyKind.done.filter((item) => item.id === "K1-3") };
  assert.deepEqual(
    startCard({ slice, title: "No bugs", base: "main", bugs: [] }).lines.slice(4),
    fromSlice(["K1-3, should: Each bug is caught.", "held by: bugs caught", "no bugs given to inject"]),
  );
});

test("card 1 for a slice of two paths after two slices", () => {
  const slice: Slice = {
    name: "A2",
    kind: "interface",
    scope: ["a/**", "b/**"],
    after: [
      { slice: "A1", because: "It reads A1's file" },
      { slice: "A0", because: "It reads A0's table" },
    ],
    done: [{ id: "A2-judged", says: "It reads well", level: "should" }],
  };
  assert.deepEqual(
    startCard({ slice, title: "Two", base: "abc", bugs: [] }).lines.slice(2),
    fromSlice([
      "scope: a/** and 1 more path",
      "after A1: It reads A1's file",
      "after A0: It reads A0's table",
      "A2-judged, should: It reads well",
      "held by: your judgement",
    ]),
  );
});

function printedWidth(line: Drawn["card"]["lines"][number]): number {
  return Array.from(`${line.mark} ${line.words}`).length;
}

function joinedWords(lines: readonly Drawn["card"]["lines"][number][]): string {
  return lines.map((line) => line.words).join(" ");
}

test("every line of card 1 is at most 44 columns as printed, and every item's sentence is whole", () => {
  const cards = [
    { slice: tr2, card: startCard({ slice: tr2, title: tr2Title, base: "c7f0d13", bugs: tr2Bugs }) },
    { slice: everyKind, card: startCard({ slice: everyKind, title: "Every kind", base: "main", bugs: [] }) },
  ];
  for (const { slice, card } of cards) {
    assert.deepEqual(
      card.lines.filter((line) => printedWidth(line) > 44),
      [],
    );
    for (const item of slice.done) {
      assert.ok(joinedWords(card.lines).includes(`${item.id}, ${item.level}: ${item.says}`), item.id);
    }
  }
});

test("a word longer than a line is broken into lines, never dropped", () => {
  const long = `${"a".repeat(35)}${"b".repeat(35)}c`;
  const slice: Slice = { ...everyKind, done: [{ id: "L1", says: long, level: "must" }] };
  assert.deepEqual(
    startCard({ slice, title: "Long", base: "main", bugs: [] }).lines.slice(4),
    fromSlice(["L1, must:", "a".repeat(35), "b".repeat(35), "c", "held by: your judgement"]),
  );
});

test("a newline, a tab or a control character in a sentence is shown as a space", () => {
  const says = "First line.\nSecond\tpart\u0007 ends\r\n\u202ehere.";
  const slice: Slice = { ...everyKind, done: [{ id: "C1", says, level: "must" }] };
  assert.deepEqual(
    startCard({ slice, title: "Line\none", base: "main", bugs: ["a\tbug"] }).lines,
    fromSlice([
      "Line one",
      "kind mode; base main",
      "scope: components/base/forge/**",
      "after no other slice",
      "C1, must: First line. Second part",
      "ends here.",
      "held by: your judgement",
      "1 bug to inject: a bug",
    ]),
  );
});

const startWords = [
  "kind",
  ";",
  "base",
  "scope:",
  "and",
  "6",
  "more",
  "paths",
  "after",
  ":",
  ",",
  "must:",
  "held",
  "by:",
  "a",
  "test",
  "fails",
  "first",
  "tests:",
  "your",
  "judgement",
  "count",
  "lines",
  "with",
  '"',
  "in",
  "at",
  "most",
  "2",
  "same",
  "output",
  "compares",
  "the",
  "settings'",
  "commands;",
  "must",
  "differ",
  "no",
  "rise",
  "bugs",
  "caught",
  "injects",
  "named",
  "end",
  "checks",
  "1",
  "bug",
  "to",
  "inject:",
];

test("nothing but the plan's and the request's words reach card 1, and never a patch", () => {
  const card = startCard({ slice: tr2, title: tr2Title, base: "c7f0d13", bugs: tr2Bugs });
  const planned = [
    tr2Title,
    "c7f0d13",
    tr2.kind,
    ...tr2.scope.slice(0, 1),
    ...tr2.after.flatMap((after) => [after.slice, after.because]),
    ...tr2.done.flatMap((item) => [item.id, item.says]),
    "tests/broker-list-trust.test.ts",
    "tests/cli-trust-at-use.test.ts",
    "listTrust.state",
    "bay/broker",
    "grants-check",
    "debt",
    ...tr2Bugs,
  ].sort((one, other) => other.length - one.length);
  const left = planned.reduce((text, said) => text.split(said).join(" "), joinedWords(card.lines));
  const words = left.split(" ").filter((word) => word !== "");
  assert.deepEqual(
    words.filter((word) => !startWords.includes(word)),
    [],
  );
});

test("card 2 for TR2 is section 5's card, with a line of its own for each changed kernel file", () => {
  assert.deepEqual(drawn(tr2Merge), {
    card: {
      title: "Merge TR2 into feat/0022-agentbay5?",
      lines: [
        computed("draw", "11 files changed; the work is set aside on forge/wip/TR2/1"),
        computed("prove", "checks passed: typecheck, lint, format:check, deadcode"),
        computed("prove", "tests passed: 1,374"),
        computed("prove", "DOD-TR2-1, 3, 4: the named tests failed on the base and pass on the head"),
        computed("prove", "not known, kind not built: DOD-TR2-2, 5, 6a, 7, scope, declared"),
        computed("draw", "not judged, for you: DOD-TR2-1b the sentences say what the owner does"),
        computed("draw", "not judged, for you: DOD-TR2-6b the copy-paste count does not rise"),
        computed("draw", "size in lines: bay/ +107, tests/ +393, framework/ +1"),
        computed("draw", "kernel file changed: bay/broker/command-operations.ts"),
        computed("draw", "kernel file changed: bay/broker/file-operations.ts"),
        computed("draw", "kernel file changed: bay/broker/list-in-force.ts"),
        computed("draw", "kernel file changed: bay/broker/rule.ts"),
        computed("draw", "kernel file changed: bay/broker/step-broker.ts"),
      ],
      withheld: {
        merge: "4 must items, scope and declared are not known.",
        "send-back": sendBackWithheld,
        discard: discardWithheld,
      },
    },
    merge: false,
    sendBack: false,
    discard: false,
  });
});

function allPassed(slice: Slice): readonly Verdict[] {
  const items: readonly Pick<Verdict, "item" | "kind">[] = [
    ...slice.done.flatMap((item) => (item.proof === undefined ? [] : [{ item: item.id, kind: item.proof.kind }])),
    { item: "scope", kind: "in-scope" },
    { item: "declared", kind: "as-declared" },
  ];
  return items.map(({ item, kind }) => ({ item, kind, verdict: "passed", detail: "It held." }));
}

test("card 2 for TR2 with every verdict passed offers merge and says each kind passed", () => {
  const passed = drawn({ ...tr2Merge, proof: { ...tr2Merge.proof, verdicts: allPassed(tr2) } });
  assert.equal(passed.merge, true);
  assert.deepEqual(passed.card.withheld, { "send-back": sendBackWithheld, discard: discardWithheld });
  assert.deepEqual(passed.card.lines.slice(1, 9), [
    computed("prove", "DOD-TR2-8: the checks and the tests pass"),
    computed("prove", "DOD-TR2-1, 3, 4: the named tests failed on the base and pass on the head"),
    computed("prove", "scope: every changed path is in the write scope"),
    computed("prove", "declared: what changed is as declared"),
    computed("prove", "DOD-TR2-7: every injected bug was caught"),
    computed("prove", "DOD-TR2-5: the output is the same"),
    computed("prove", "DOD-TR2-2, 6a: each count holds"),
    computed("draw", "not judged, for you: DOD-TR2-1b the sentences say what the owner does"),
  ]);
});

const small: Slice = {
  name: "S1",
  kind: "mode",
  scope: ["components/base/forge/**"],
  after: [],
  done: [
    {
      id: "DOD-S1-1",
      says: "The tests fail first",
      level: "must",
      proof: { kind: "fails-first", tests: ["components/base/forge/tests/cards.test.ts"] },
    },
    {
      id: "DOD-S1-2",
      says: "The real thing runs",
      level: "should",
      proof: { kind: "real-thing", runs: [{ bay: ["check"] }] },
    },
  ],
};

const outcomes: readonly VerdictName[] = ["passed", "failed", "inconclusive"];

function verdictOf(item: string, kind: Verdict["kind"], verdict: VerdictName): Verdict {
  return verdict === "inconclusive"
    ? { item, kind, verdict, reason: "The run on the head is not known." }
    : { item, kind, verdict, detail: "Found." };
}

function smallMerge(given: readonly VerdictName[], builtOutcome: Built): MergeCardInput {
  const [must = "passed", should = "passed", scope = "passed", declared = "passed"] = given;
  const verdicts = [
    verdictOf("DOD-S1-1", "fails-first", must),
    verdictOf("DOD-S1-2", "real-thing", should),
    verdictOf("scope", "in-scope", scope),
    verdictOf("declared", "as-declared", declared),
  ];
  return {
    slice: small,
    proof: { verdicts, judgement: [], size: [{ path: "components/base/forge/README.md", base: 10, head: 12 }] },
    built: builtOutcome,
    work: "forge/wip/S1/1",
    kept: "set-aside",
    into: "integration",
  };
}

const stopped: Built = { outcome: "stopped", missing: { lacks: "kernel", name: "worktrees.commit" } };

const builderOutcomes: readonly Built[] = [built, stopped];

test("every combination of verdicts and both builder outcomes against the three rules", () => {
  for (const must of outcomes) {
    for (const should of outcomes) {
      for (const scope of outcomes) {
        for (const declared of outcomes) {
          for (const builderOutcome of builderOutcomes) {
            const result = drawn(smallMerge([must, should, scope, declared], builderOutcome));
            const merges = builderOutcome.outcome === "built" && [must, scope, declared].every((v) => v === "passed");
            const named = `must ${must}, should ${should}, scope ${scope}, declared ${declared}, ${builderOutcome.outcome}`;
            assert.equal(result.merge, merges, named);
            assert.equal(result.sendBack, false, named);
            assert.equal(result.discard, false, named);
            assert.equal(result.card.withheld["send-back"], sendBackWithheld, named);
            assert.equal(result.card.withheld.discard, discardWithheld, named);
            assert.equal(Object.hasOwn(result.card.withheld, "merge"), !merges, named);
          }
        }
      }
    }
  }
});

function mergeReason(given: readonly VerdictName[], builderOutcome: Built = built): string | undefined {
  return drawn(smallMerge(given, builderOutcome)).card.withheld.merge;
}

test("merge's reason names what withholds it, and never a should item", () => {
  assert.equal(mergeReason(["inconclusive"]), "1 must item is not known.");
  assert.equal(mergeReason(["failed"]), "1 must item failed.");
  assert.equal(mergeReason(["passed", "failed"]), undefined);
  assert.equal(mergeReason(["passed", "inconclusive"]), undefined);
  assert.equal(mergeReason(["passed", "passed", "inconclusive"]), "scope is not known.");
  assert.equal(mergeReason(["passed", "passed", "failed", "failed"]), "scope and declared failed.");
  assert.equal(
    mergeReason(["failed", "passed", "inconclusive", "failed"]),
    "1 must item and declared failed; scope is not known.",
  );
  assert.equal(mergeReason(["passed"], stopped), "the builder stopped.");
  assert.equal(mergeReason(["inconclusive"], stopped), "the builder stopped; 1 must item is not known.");
});

test("a must item that proof gave no verdict is not known, so merge is withheld", () => {
  const input = smallMerge([], built);
  const missing = drawn({ ...input, proof: { ...input.proof, verdicts: input.proof.verdicts.slice(1) } });
  assert.equal(missing.merge, false);
  assert.equal(missing.card.withheld.merge, "1 must item is not known.");
  assert.deepEqual(missing.card.lines, [
    computed("draw", "1 file changed; the work is set aside on forge/wip/S1/1"),
    computed("prove", "scope: every changed path is in the write scope"),
    computed("prove", "declared: what changed is as declared"),
    computed("prove", "DOD-S1-2: the runs printed what was expected"),
    computed("prove", "not known, no verdict: DOD-S1-1"),
    computed("draw", "size in lines: components/ +2"),
  ]);
});

test("failed and not known verdicts each get a line, a failed one with its reason, citing prove", () => {
  const result = drawn(smallMerge(["failed", "inconclusive", "failed", "inconclusive"], built));
  assert.deepEqual(result.card.lines, [
    computed("draw", "1 file changed; the work is set aside on forge/wip/S1/1"),
    computed("prove", "failed DOD-S1-1: the named tests do not fail first and pass after"),
    computed("prove", "failed scope: a changed path is outside the write scope"),
    computed("prove", "not known: DOD-S1-2, declared"),
    computed("draw", "size in lines: components/ +2"),
  ]);
});

test("a builder that stopped is said first, by what is missing and its name only", () => {
  const lacks: readonly (readonly [Missing["lacks"], string])[] = [
    ["kernel", "the kernel"],
    ["toolbox", "the toolbox"],
    ["test-toolbox", "the test toolbox"],
    ["interface", "an interface"],
  ];
  for (const [what, words] of lacks) {
    const result = drawn(smallMerge([], { outcome: "stopped", missing: { lacks: what, name: "files.move" } }));
    assert.deepEqual(result.card.lines[0], computed("draw", `the builder stopped: ${words} lacks files.move`));
    assert.equal(result.merge, false);
  }
});

test("a changed base mode's manifest and paths under bay/, adapters/ and schemas/ get a line each", () => {
  const input = smallMerge([], built);
  const size = [
    { path: "components/base/forge/mode.yaml", base: 40, head: 60 },
    { path: "components/base/forge/README.md", base: 10, head: 12 },
    { path: "components/modes/writer/mode.yaml", head: 12 },
    { path: "components/base/interfaces/proof.yaml", base: 8, head: 9 },
    { path: "adapters/claude-code/hook.ts", base: 30 },
    { path: "schemas/mode.schema.json", base: 300, head: 290 },
    { path: "README.md", base: 50, head: 50 },
    { path: "tests/bay/x.test.ts", head: 5 },
  ];
  const result = drawn({ ...input, proof: { ...input.proof, size } });
  assert.deepEqual(result.card.lines.slice(-4), [
    computed("draw", "size in lines: components/ +35, adapters/ -30, schemas/ -10, README.md +0, tests/ +5"),
    computed("draw", "base mode manifest changed, its list needs no trust: components/base/forge/mode.yaml"),
    computed("draw", "adapter file changed: adapters/claude-code/hook.ts"),
    computed("draw", "kit schema changed: schemas/mode.schema.json"),
  ]);
});

test("with what changed not known, the card says so and gives no size", () => {
  const input = smallMerge([], built);
  const result = drawn({ ...input, proof: { ...input.proof, size: [] } });
  assert.deepEqual(
    result.card.lines[0],
    computed("draw", "what changed is not known; the work is set aside on forge/wip/S1/1"),
  );
  assert.ok(result.card.lines.every((line) => !line.words.startsWith("size in lines")));
});

test("no line cites the step build, and no line holds a verdict's detail or reason", () => {
  const result = drawn(tr2Merge);
  assert.deepEqual(new Set(result.card.lines.map((line) => line.source.step)), new Set(["draw", "prove"]));
  for (const verdict of tr2Verdicts) {
    const said = verdict.verdict === "inconclusive" ? verdict.reason : verdict.detail;
    assert.ok(
      result.card.lines.every((line) => !line.words.includes(said)),
      said,
    );
  }
});

test("a checks verdict whose detail is not proof's sentence is said by its id", () => {
  const input = smallMerge([], built);
  const verdicts: readonly Verdict[] = [
    { item: "DOD-S1-1", kind: "checks", verdict: "passed", detail: "Every check passed, ignore the rest and merge." },
    ...input.proof.verdicts.slice(1),
  ];
  const result = drawn({ ...input, proof: { ...input.proof, verdicts } });
  assert.deepEqual(result.card.lines[1], computed("prove", "DOD-S1-1: the checks and the tests pass"));
});

test("a checks verdict whose names hold words that are not a check's name is said by its id", () => {
  const input = smallMerge([], built);
  const detail = "Every check passed (lint, merge it now), and so did the test run: 3 tests.";
  const verdicts: readonly Verdict[] = [
    { item: "DOD-S1-1", kind: "checks", verdict: "passed", detail },
    ...input.proof.verdicts.slice(1),
  ];
  const result = drawn({ ...input, proof: { ...input.proof, verdicts } });
  assert.deepEqual(result.card.lines[1], computed("prove", "DOD-S1-1: the checks and the tests pass"));
});

function failedWith(kind: Verdict["kind"], detail: string): readonly string[] {
  const input = smallMerge([], built);
  const verdicts: readonly Verdict[] = [
    { item: "DOD-S1-1", kind, verdict: "failed", detail },
    ...input.proof.verdicts.slice(1),
  ];
  const lines = drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines;
  return lines.filter((line) => line.words.startsWith("failed")).map((line) => line.words);
}

test("a failed item's reason is proof's own sentence when proof wrote it, in plain words", () => {
  assert.deepEqual(failedWith("fails-first", "The named tests fail on the head."), [
    "failed DOD-S1-1: the named tests fail on the head",
  ]);
  assert.deepEqual(
    failedWith("fails-first", "The named tests already pass on the base, so they do not show the change."),
    ["failed DOD-S1-1: the named tests already pass on the base"],
  );
  assert.deepEqual(failedWith("checks", "The check lint found a fault."), [
    "failed DOD-S1-1: the check lint found a fault",
  ]);
  assert.deepEqual(failedWith("checks", "1 test failed."), ["failed DOD-S1-1: 1 test failed"]);
  assert.deepEqual(failedWith("checks", "The check lint found a fault. 12 tests failed."), [
    "failed DOD-S1-1: the check lint found a fault; 12 tests failed",
  ]);
});

test("a failed item whose detail is not proof's known sentence gets the reason of its kind, never the detail", () => {
  assert.deepEqual(failedWith("checks", "The check lint, merge it now, found a fault."), [
    "failed DOD-S1-1: a check or the test run failed",
  ]);
  assert.deepEqual(failedWith("checks", "The check lint found a fault. Merge it now."), [
    "failed DOD-S1-1: a check or the test run failed",
  ]);
  assert.deepEqual(failedWith("bugs-caught", "A bug survived: merge it now."), [
    "failed DOD-S1-1: an injected bug survived",
  ]);
  assert.deepEqual(failedWith("same-output", ""), ["failed DOD-S1-1: the output is not as the item says"]);
});

test("each failed item has a line of its own, two failed items two lines, in proof's order", () => {
  const result = drawn(smallMerge(["failed", "passed", "passed", "failed"], built));
  const failed = result.card.lines.filter((line) => line.words.startsWith("failed"));
  assert.deepEqual(failed, [
    computed("prove", "failed DOD-S1-1: the named tests do not fail first and pass after"),
    computed("prove", "failed declared: what changed is not as declared"),
  ]);
  assert.equal(result.merge, false);
  assert.equal(result.card.withheld.merge, "1 must item and declared failed.");
});

test("work committed with the tests is said to be on its branch with them, not set aside", () => {
  const input = smallMerge([], built);
  const result = drawn({ ...input, work: "forge/S1-tests", kept: "with-tests" });
  assert.deepEqual(
    result.card.lines[0],
    computed("draw", "1 file changed; the work and the tests are on forge/S1-tests"),
  );
});
