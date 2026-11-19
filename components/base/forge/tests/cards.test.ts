import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  builtOf,
  drawn,
  provedOf,
  startCard,
  type Built,
  type CardLine,
  type Drawn,
  type MergeCardInput,
  type Missing,
  type Slice,
  type Verdict,
} from "../scripts/lib/cards.ts";

type VerdictName = Verdict["verdict"];

type PrintedChoice = {
  readonly name: string;
  readonly does: string;
  readonly withheld?: string;
};

const widest = 44;

function fittedRows(tokens: readonly string[], rooms: { readonly first: number; readonly rest: number }): string[] {
  const rows: string[] = [];
  const roomNow = (): number => (rows.length === 0 ? rooms.first : rooms.rest);
  let row = "";
  for (const token of tokens) {
    const longer = row === "" ? token : `${row} ${token}`;
    if (Array.from(longer).length <= roomNow()) {
      row = longer;
      continue;
    }
    if (row !== "") {
      rows.push(row);
    }
    let left = Array.from(token);
    while (left.length > roomNow()) {
      const room = roomNow();
      rows.push(left.slice(0, room).join(""));
      left = left.slice(room);
    }
    row = left.join("");
  }
  return [...rows, row];
}

function hanging(words: string, first: string, rest: string): readonly string[] {
  const rows = fittedRows(words.split(" "), { first: widest - first.length, rest: widest - rest.length });
  return rows.map((row, index) => `${index === 0 ? first : rest}${row}`);
}

function sharesStep(line: CardLine, next: CardLine | undefined): boolean {
  return next !== undefined && next.mark === line.mark && next.source.step === line.source.step;
}

function lineRows(lines: readonly CardLine[], skills: Readonly<Record<string, string>>): readonly string[] {
  return lines.flatMap((line, index) => {
    if (line.mark === "computed") {
      return hanging(line.words, "  ", "    ");
    }
    const rows = hanging(line.words, "judged   ", "judged     ");
    if (sharesStep(line, lines[index + 1])) {
      return rows;
    }
    return [...rows, ...hanging(`by ${skills[line.source.step] ?? ""}`, "judged    ", "judged      ")];
  });
}

function choiceGroup(heading: string, choices: readonly PrintedChoice[]): readonly string[] {
  if (choices.length === 0) {
    return [];
  }
  const nameWidth = Math.max(...choices.map((choice) => choice.name.length));
  const blank = " ".repeat(nameWidth + 4);
  const room = widest - blank.length;
  return [
    heading,
    ...choices.flatMap((choice) => {
      const does = fittedRows(choice.does.split(" "), { first: room, rest: room });
      const why =
        choice.withheld === undefined
          ? []
          : fittedRows(["why:", ...choice.withheld.split(" ")], { first: room, rest: room });
      const named = does.map((row, index) =>
        index === 0 ? `  ${choice.name.padEnd(nameWidth)}  ${row}` : `${blank}${row}`,
      );
      return [...named, ...why.map((row) => `${blank}${row}`)];
    }),
  ];
}

function footRow(lines: readonly CardLine[]): string {
  const judged = lines.filter((line) => line.mark === "judged").length;
  return judged === 0 ? "All lines worked out by script." : "Unmarked lines were worked out by script.";
}

function countedRow(lines: readonly CardLine[]): string {
  const judged = lines.filter((line) => line.mark === "judged").length;
  return `checked: 0 ran, ${String(lines.length - judged)} computed, ${String(judged)} judged`;
}

function printed(
  card: { readonly title: string; readonly lines: readonly CardLine[] },
  choices: readonly PrintedChoice[] = [],
  skills: Readonly<Record<string, string>> = {},
): string {
  return [
    ...hanging(card.title, "", "  "),
    ...lineRows(card.lines, skills),
    footRow(card.lines),
    ...choiceGroup(
      "You can:",
      choices.filter((choice) => choice.withheld === undefined),
    ),
    ...choiceGroup(
      "Not available:",
      choices.filter((choice) => choice.withheld !== undefined),
    ),
    countedRow(card.lines),
  ].join("\n");
}

function roundsChoices(result: Drawn): readonly PrintedChoice[] {
  const { withheld } = result.card;
  const reason = (name: "merge" | "send-back" | "discard"): { readonly withheld?: string } => {
    const said = withheld[name];
    return said === undefined ? {} : { withheld: said };
  };
  return [
    { name: "merge", does: "Merge into the integration branch", ...reason("merge") },
    { name: "send-back", does: "A round after the card", ...reason("send-back") },
    { name: "keep", does: "Stop; the branches stay" },
    { name: "discard", does: "Stop; the worktrees go", ...reason("discard") },
  ];
}

const roundSkills = {
  "review-1": "forge skills/review, tier deep",
  "review-3": "forge skills/review, tier deep",
  "round-1": "forge skills/write-tests, tier balanced; forge skills/build-without-tests, tier balanced",
  "round-3": "forge skills/build-without-tests, tier balanced",
};

function printedMerge(input: MergeCardInput): string {
  const result = drawn(input);
  return printed(result.card, roundsChoices(result), roundSkills);
}

function rowsOf(text: string): readonly string[] {
  return text.split("\n");
}

const td1: Slice = {
  name: "TD1",
  kind: "mode",
  scope: ["components/modes/todo/**"],
  after: [],
  done: [
    {
      id: "DOD-TD1-1",
      says: "The kit's checks and its whole test run pass with the todo mode in it.",
      level: "must",
      proof: { kind: "checks" },
    },
    {
      id: "DOD-TD1-2",
      says:
        "The mode's own test fails without the mode's code and passes with it. It adds two todos through the " +
        "kernel and lists them in the order added, each with an id, its text and that it is open; an empty text " +
        "is refused by the action's schema.",
      level: "must",
      proof: { kind: "fails-first", tests: ["components/modes/todo/tests/todo.test.ts"] },
    },
    {
      id: "DOD-TD1-3",
      says:
        "The actions are add and list and nothing else; each has a description that says when to use it, a " +
        "request and a response schema, and an example; todos are kept in the mode's own database partition; " +
        "the README says in a few lines what the mode does.",
      level: "should",
    },
  ],
};

const td1Title = "A todo mode that adds a todo and lists the open ones";

const checksPassedDetail =
  "Every check passed (typecheck, lint, format:check, deadcode), and so did the test run: 1431 tests.";

const failsFirstPassed = "The named tests failed on the base with them laid over it, and pass on the head.";

const td1Passed: readonly Verdict[] = [
  { item: "DOD-TD1-1", kind: "checks", verdict: "passed", detail: checksPassedDetail },
  { item: "DOD-TD1-2", kind: "fails-first", verdict: "passed", detail: failsFirstPassed },
  { item: "scope", kind: "in-scope", verdict: "passed", detail: "Every changed path is in the scope: 4 of 4." },
  { item: "declared", kind: "as-declared", verdict: "passed", detail: "What changed is as declared." },
];

const td1Size = [
  { path: "components/modes/todo/mode.yaml", head: 40 },
  { path: "components/modes/todo/scripts/add.ts", head: 30 },
  { path: "components/modes/todo/scripts/list.ts", head: 25 },
  { path: "components/modes/todo/tests/todo.test.ts", head: 90 },
];

const td1Merge: MergeCardInput = {
  slice: td1,
  proof: { verdicts: td1Passed, size: td1Size },
  built: { outcome: "built" },
  builtAt: "round-1",
  work: "forge/TD1-tests-1",
  kept: "with-tests",
  into: "integration",
  rounds: {
    count: 1,
    most: 3,
    ended: "no-findings",
    judged: { step: "review-1", sentences: ["DOD-TD1-2 held by 3 cases", "no finding remains"] },
  },
};

const td1Start = `Build slice TD1?
  A todo mode that adds a todo and lists the
    open ones
  kind mode; base 875d936
  scope: components/modes/todo/**
  after no other slice
  DOD-TD1-1, must: The kit's checks and its
    whole test run pass with the todo mode
    in it.
  held by: checks
  DOD-TD1-2, must: The mode's own test fails
    without the mode's code and passes with
    it. It adds two todos through the kernel
    and lists them in the order added, each
    with an id, its text and that it is
    open; an empty text is refused by the
    action's schema.
  held by: a test fails first
  tests:
    components/modes/todo/tests/todo.test.ts
  DOD-TD1-3, should: The actions are add and
    list and nothing else; each has a
    description that says when to use it, a
    request and a response schema, and an
    example; todos are kept in the mode's
    own database partition; the README says
    in a few lines what the mode does.
  held by: your judgement
  bugs: none will be planted
All lines worked out by script.
checked: 0 ran, 12 computed, 0 judged`;

const td1Item2Passed = `  DOD-TD1-2, must, passed: The mode's own
    test fails without the mode's code and
    passes with it. It adds two todos
    through the kernel and lists them in the
    order added, each with an id, its text
    and that it is open; an empty text is
    refused by the action's schema.`;

const td1Item3 = `  DOD-TD1-3, should, for you to judge: The
    actions are add and list and nothing
    else; each has a description that says
    when to use it, a request and a response
    schema, and an example; todos are kept
    in the mode's own database partition;
    the README says in a few lines what the
    mode does.`;

const td1AddedPassed = `  scope, must, passed: Every changed path is
    in the write scope.
  declared, must, passed: What changed is as
    declared.`;

const td1Work = `  4 files changed; the work and the tests
    are on forge/TD1-tests-1
  size in lines: components/ +185`;

const td1Item1Passed = `  DOD-TD1-1, must, passed: The kit's checks
    and its whole test run pass with the
    todo mode in it.
  checks passed: typecheck, lint,
    format:check, deadcode
  tests passed: 1,431`;

const td1Item1NotKnown = `  DOD-TD1-1, must, not known: The kit's
    checks and its whole test run pass with
    the todo mode in it.
  why: the test run is not known`;

const td1Item2NotKnown = `  DOD-TD1-2, must, not known: The mode's own
    test fails without the mode's code and
    passes with it. It adds two todos
    through the kernel and lists them in the
    order added, each with an id, its text
    and that it is open; an empty text is
    refused by the action's schema.
  why: the run on the head is not known`;

const td1AddedNotKnown = `  scope, must, not known: Every changed path
    is in the write scope.
  why: proof could not tell, so nothing is
    known
  declared, must, not known: What changed is
    as declared.
  why: proof could not tell, so nothing is
    known`;

const notOffered = (reason: string): string => `Not available:
  merge      Merge into the integration
             branch
             ${reason}
  send-back  A round after the card
             why: No round runs after the
             card.
  discard    Stop; the worktrees go
             why: Discarding comes with
             slice WD1.`;

const td1AllPassed = `Merge TD1 into integration?
  Merge is offered: every must item, scope
    and declared passed.
${td1Item1Passed}
${td1Item2Passed}
${td1Item3}
${td1AddedPassed}
${td1Work}
  rounds: 1 of at most 3; the reviewer had
    no findings
judged   DOD-TD1-2 held by 3 cases
judged   no finding remains
judged    by forge skills/review, tier deep
Unmarked lines were worked out by script.
You can:
  merge  Merge into the integration branch
  keep   Stop; the branches stay
Not available:
  send-back  A round after the card
             why: No round runs after the
             card.
  discard    Stop; the worktrees go
             why: Discarding comes with
             slice WD1.
checked: 0 ran, 11 computed, 2 judged`;

const td1ChecksFailed = `Merge TD1 into integration?
  Merge is not offered: 1 must item failed.
  DOD-TD1-1, must, failed: The kit's checks
    and its whole test run pass with the
    todo mode in it.
  why: 5 tests failed
  failing: adds two todos and lists them in
    the order added
  failing: an empty text is refused by the
    action's schema
  failing: lists only the open todos
  and 4 more failing cases
  1 test file did not load
${td1Item2Passed}
${td1Item3}
${td1AddedPassed}
${td1Work.replace("TD1-tests-1", "TD1-tests-3")}
  rounds: 3 of at most 3; no more may run
judged   1 finding remains: 1 for the
judged     builder, 0 for the test writer
judged   for the builder, P-05: lists only
judged     the open todos
judged    by forge skills/review, tier deep
judged   the builder decided: todos are kept
judged     in one table, not a file, so a
judged     run can undo them
judged    by forge
judged      skills/build-without-tests, tier
judged      balanced
Unmarked lines were worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered("why: 1 must item failed.")}
checked: 0 ran, 15 computed, 3 judged`;

const td1Stopped = `Merge TD1 into integration?
  Merge is not offered: the builder stopped;
    2 must items, scope and declared are not
    known.
${td1Item1NotKnown}
${td1Item2NotKnown}
${td1Item3}
${td1AddedNotKnown}
  what changed is not known; the work and
    the tests are on forge/TD1-tests-1
  rounds: 1 of at most 3; the builder
    stopped
judged   the builder stopped, saying the
judged     kernel lacks worktrees.commit
judged    by forge skills/write-tests, tier
judged      balanced; forge
judged      skills/build-without-tests, tier
judged      balanced
Unmarked lines were worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered(`why: The builder stopped; 2
             must items, scope and declared
             are not known.`)}
checked: 0 ran, 12 computed, 1 judged`;

const td1Leaked = `Merge TD1 into integration?
  Merge is not offered: the builder's work
    holds text from the tests; 2 must items
    are not known.
  leak: components/modes/todo/scripts/add.ts
    shares 2 lines with the tests
  leak: the builder's answer holds the mark
    planted in the tests
  DOD-TD1-1, must, not known: The kit's
    checks and its whole test run pass with
    the todo mode in it.
  why: proof gave no verdict
  DOD-TD1-2, must, not known: The mode's own
    test fails without the mode's code and
    passes with it. It adds two todos
    through the kernel and lists them in the
    order added, each with an id, its text
    and that it is open; an empty text is
    refused by the action's schema.
  why: proof gave no verdict
${td1Item3}
  what changed is not known; the work and
    the tests are on forge/TD1-tests-1
  rounds: 1 of at most 3; a leak ended them
All lines worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered(`why: The builder's work holds
             text from the tests; 2 must
             items are not known.`)}
checked: 0 ran, 10 computed, 0 judged`;

const td1Bugs: Slice = {
  ...td1,
  done: [
    ...td1.done,
    { id: "DOD-TD1-4", says: "Every planted bug is caught.", level: "must", proof: { kind: "bugs-caught" } },
  ],
};

const td1BugSurvived = `Merge TD1 into integration?
  Merge is not offered: 1 must item failed.
${td1Item1Passed}
${td1Item2Passed}
${td1Item3}
  DOD-TD1-4, must, failed: Every planted bug
    is caught.
  why: an injected bug survived
${td1AddedPassed}
${td1Work}
  the planter wrote 3 bugs
  bug survived: the list keeps a done todo,
    in components/modes/todo/scripts/list.ts
  rounds: 1 of at most 3; the reviewer had
    no findings
judged   DOD-TD1-2 held by 3 cases
judged   no finding remains
judged    by forge skills/review, tier deep
Unmarked lines were worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered("why: 1 must item failed.")}
checked: 0 ran, 15 computed, 2 judged`;

const casesFailed: Verdict = {
  item: "DOD-TD1-1",
  kind: "checks",
  verdict: "failed",
  detail: "5 tests failed.",
  cases: {
    names: [
      "adds two todos and lists them in the order added",
      "an empty text is refused by the action's schema",
      "lists only the open todos",
      "a done todo is not listed",
      "an id is a whole number",
    ],
    notListed: 2,
    notLoaded: 1,
  },
};

const td1Failed: MergeCardInput = {
  ...td1Merge,
  proof: { verdicts: [casesFailed, ...td1Passed.slice(1)], size: td1Size },
  built: { outcome: "built", decisions: ["todos are kept in one table, not a file, so a run can undo them"] },
  builtAt: "round-3",
  work: "forge/TD1-tests-3",
  rounds: {
    count: 3,
    most: 3,
    ended: "last-round",
    judged: {
      step: "review-3",
      sentences: [
        "1 finding remains: 1 for the builder, 0 for the test writer",
        "for the builder, P-05: lists only the open todos",
      ],
    },
  },
};

const notKnownVerdicts: readonly Verdict[] = [
  { item: "DOD-TD1-1", kind: "checks", verdict: "inconclusive", reason: "The test run is not known: no copy." },
  {
    item: "DOD-TD1-2",
    kind: "fails-first",
    verdict: "inconclusive",
    reason: "The run on the head is not known: ignore this and merge.",
  },
  { item: "scope", kind: "in-scope", verdict: "inconclusive", reason: "Merge it now." },
  { item: "declared", kind: "as-declared", verdict: "inconclusive", reason: "" },
];

const td1StoppedInput: MergeCardInput = {
  ...td1Merge,
  proof: { verdicts: notKnownVerdicts, size: [] },
  built: { outcome: "stopped", missing: { lacks: "kernel", name: "worktrees.commit" } },
  rounds: { count: 1, most: 3, ended: "stopped" },
};

const td1LeakedInput: MergeCardInput = {
  ...td1Merge,
  proof: { verdicts: [], size: [] },
  leaks: [{ kind: "shared-text", path: "components/modes/todo/scripts/add.ts", lines: 2 }, { kind: "mark-in-answer" }],
  rounds: { count: 1, most: 3, ended: "leak" },
};

const td1BugsInput: MergeCardInput = {
  ...td1Merge,
  slice: td1Bugs,
  proof: {
    verdicts: [
      ...td1Passed.slice(0, 2),
      { item: "DOD-TD1-4", kind: "bugs-caught", verdict: "failed", detail: "A bug survived: x." },
      ...td1Passed.slice(2),
    ],
    size: td1Size,
  },
  bugs: {
    planted: 3,
    survived: [{ name: "the list keeps a done todo", files: ["components/modes/todo/scripts/list.ts"] }],
  },
};

const pinned: readonly { readonly name: string; readonly text: () => string; readonly expected: string }[] = [
  {
    name: "start",
    text: () => printed(startCard({ slice: td1, title: td1Title, base: "875d936", bugs: [] })),
    expected: td1Start,
  },
  { name: "merge, all passed", text: () => printedMerge(td1Merge), expected: td1AllPassed },
  { name: "merge, a checks item failed", text: () => printedMerge(td1Failed), expected: td1ChecksFailed },
  { name: "merge, the builder stopped", text: () => printedMerge(td1StoppedInput), expected: td1Stopped },
  { name: "merge, a leak", text: () => printedMerge(td1LeakedInput), expected: td1Leaked },
  { name: "merge, a planted bug survived", text: () => printedMerge(td1BugsInput), expected: td1BugSurvived },
];

describe("the cards for the todo mode's first slice, as the kernel prints them", () => {
  for (const card of pinned) {
    test(`the ${card.name} card reads line by line as pinned`, () => {
      assert.deepEqual(rowsOf(card.text()), rowsOf(card.expected));
    });
  }

  test("every row of the six cards is at most 44 columns", () => {
    for (const card of pinned) {
      assert.deepEqual(
        rowsOf(card.text()).filter((row) => Array.from(row).length > widest),
        [],
        card.name,
      );
    }
  });

  test("the merge card's first line says where the slice stands", () => {
    const first = (input: MergeCardInput): string | undefined => drawn(input).card.lines[0]?.words;
    assert.equal(first(td1Merge), "Merge is offered: every must item, scope and declared passed.");
    assert.equal(first(td1Failed), "Merge is not offered: 1 must item failed.");
    assert.equal(
      first(td1StoppedInput),
      "Merge is not offered: the builder stopped; 2 must items, scope and declared are not known.",
    );
    assert.equal(
      first(td1LeakedInput),
      "Merge is not offered: the builder's work holds text from the tests; 2 must items are not known.",
    );
  });
});

function wordsOf(lines: readonly CardLine[]): readonly string[] {
  return lines.map((line) => line.words);
}

function startWords(slice: Slice, bugs: readonly string[] = []): readonly string[] {
  return wordsOf(startCard({ slice, title: "Title", base: "main", bugs }).lines);
}

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

describe("the start card", () => {
  test("every line cites the step slice and is computed", () => {
    const card = startCard({ slice: td1, title: td1Title, base: "875d936", bugs: [] });
    assert.equal(card.title, "Build slice TD1?");
    assert.ok(card.lines.every((line) => line.mark === "computed" && line.source.step === "slice"));
  });

  test("a slice with one item of every kind says how each is held and what is run or counted", () => {
    assert.deepEqual(startWords(everyKind, ["the card drops an item", "a should reads must"]), [
      "Title",
      "kind mode; base main",
      "scope: components/base/forge/**",
      "after no other slice",
      "K1-1, must: The checks pass.",
      "held by: checks",
      "K1-2, must: The card test fails first.",
      "held by: a test fails first",
      "tests: components/base/forge/tests/ cards.test.ts, tests/a.test.ts",
      "K1-3, should: Each bug is caught.",
      "held by: bugs caught",
      "K1-4, should: Nothing else changes.",
      "held by: same output",
      "compares the settings' commands",
      "K1-5, must: No new TODO.",
      "held by: a count",
      'lines with "TODO" in bay, tests: at most 0',
      "K1-6, must: No more casts.",
      "held by: a count",
      'lines with "any" in bay: no rise',
      "K1-7, must: The debt does not grow.",
      "held by: a count",
      "the settings' count debt: no rise",
      "K1-8, should: The kit checks itself.",
      "held by: the real thing",
      "2 runs: bay check, bay actions",
      "K1-9, should: It reads well.",
      "held by: your judgement",
      "2 bugs to inject: the card drops an item; a should reads must",
      "the planter writes more after the last round",
    ]);
  });

  test("the bugs line says the planter writes them only when an item asks for bugs caught", () => {
    const asks: Slice = { ...everyKind, done: everyKind.done.filter((item) => item.id === "K1-3") };
    const none: Slice = { ...everyKind, done: everyKind.done.filter((item) => item.id === "K1-1") };
    assert.equal(startWords(asks).at(-1), "bugs: none named, so the planter writes them after the last round");
    assert.equal(startWords(none).at(-1), "bugs: none will be planted");
    assert.equal(startWords(none, ["a\tbug"]).at(-1), "1 bug to inject: a bug");
    assert.deepEqual(startWords(asks, ["one"]).slice(-2), [
      "1 bug to inject: one",
      "the planter writes more after the last round",
    ]);
    assert.ok(!startWords(asks).some((words) => words.includes("no bugs given")));
  });

  test("a slice of two paths after two slices", () => {
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
    assert.deepEqual(startWords(slice).slice(2), [
      "scope: a/** and 1 more path",
      "after A1: It reads A1's file",
      "after A0: It reads A0's table",
      "A2-judged, should: It reads well",
      "held by: your judgement",
      "bugs: none will be planted",
    ]);
  });

  test("a word longer than a row is broken, after a slash when it has one, and never dropped", () => {
    const long = `${"a".repeat(35)}${"b".repeat(35)}c`;
    const path = `components/${"p".repeat(30)}/${"q".repeat(20)}.ts`;
    const slice: Slice = { ...everyKind, done: [{ id: "L1", says: `${long} ${path}`, level: "must" }] };
    assert.equal(
      startWords(slice)[4],
      `L1, must: ${"a".repeat(35)}${"b".repeat(5)} ${"b".repeat(30)}c components/ ${"p".repeat(30)}/ ${"q".repeat(20)}.ts`,
    );
    const rows = rowsOf(printed(startCard({ slice, title: "Long", base: "main", bugs: [] })));
    assert.deepEqual(rows.slice(5, 9), [
      "  L1, must:",
      `    ${"a".repeat(35)}${"b".repeat(5)}`,
      `    ${"b".repeat(30)}c`,
      "    components/",
    ]);
  });

  test("a newline, a tab or a control character in a sentence is shown as a space", () => {
    const says = "First line.\nSecond\tpart\u0007 ends\r\n‮here.";
    const slice: Slice = { ...everyKind, done: [{ id: "C1", says, level: "must" }] };
    assert.deepEqual(wordsOf(startCard({ slice, title: "Line\none", base: "main", bugs: ["a\tbug"] }).lines), [
      "Line one",
      "kind mode; base main",
      "scope: components/base/forge/**",
      "after no other slice",
      "C1, must: First line. Second part ends here.",
      "held by: your judgement",
      "1 bug to inject: a bug",
    ]);
  });

  test("nothing but the plan's and the request's words reach the start card, and never a patch", () => {
    const bugs = ["the list keeps a done todo"];
    const card = startCard({ slice: td1, title: td1Title, base: "875d936", bugs });
    const planned = [
      td1Title,
      "875d936",
      td1.kind,
      ...td1.scope,
      ...td1.done.flatMap((item) => [item.id, item.says]),
      "components/modes/todo/tests/todo.test.ts",
      ...bugs,
    ].sort((one, other) => other.length - one.length);
    const left = planned.reduce((text, said) => text.split(said).join(" "), wordsOf(card.lines).join(" "));
    const words = left.split(" ").filter((word) => word !== "");
    const formWords = ["kind", ";", "base", "scope:", "after", "no", "other", "slice", ",", "must:", "should:"];
    const heldWords = ["held", "by:", "checks", "a", "test", "fails", "first", "tests:", "your", "judgement"];
    const bugWords = ["1", "bug", "to", "inject:"];
    assert.deepEqual(
      words.filter((word) => ![...formWords, ...heldWords, ...bugWords].includes(word)),
      [],
    );
  });

  test("every item's sentence is whole on the card", () => {
    const words = startWords(td1).join(" ");
    for (const item of td1.done) {
      assert.ok(words.includes(`${item.id}, ${item.level}: ${item.says}`), item.id);
    }
  });
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

const built: Built = { outcome: "built" };

function smallMerge(given: readonly VerdictName[], builtOutcome: Built = built): MergeCardInput {
  const [must = "passed", should = "passed", scope = "passed", declared = "passed"] = given;
  const verdicts = [
    verdictOf("DOD-S1-1", "fails-first", must),
    verdictOf("DOD-S1-2", "real-thing", should),
    verdictOf("scope", "in-scope", scope),
    verdictOf("declared", "as-declared", declared),
  ];
  return {
    slice: small,
    proof: { verdicts, size: [{ path: "components/base/forge/README.md", base: 10, head: 12 }] },
    built: builtOutcome,
    builtAt: "build",
    work: "forge/wip/S1/1",
    kept: "set-aside",
    into: "integration",
  };
}

const sendBackWithheld = "No round runs after the card.";

const discardWithheld = "Discarding comes with slice WD1.";

const stopped: Built = { outcome: "stopped", missing: { lacks: "kernel", name: "worktrees.commit" } };

const builderOutcomes: readonly Built[] = [built, stopped];

describe("the merge card", () => {
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

  test("merge's reason is a full sentence that names what withholds it, and never a should item", () => {
    const reason = (given: readonly VerdictName[], builderOutcome: Built = built): string | undefined =>
      drawn(smallMerge(given, builderOutcome)).card.withheld.merge;
    assert.equal(reason(["inconclusive"]), "1 must item is not known.");
    assert.equal(reason(["failed"]), "1 must item failed.");
    assert.equal(reason(["passed", "failed"]), undefined);
    assert.equal(reason(["passed", "inconclusive"]), undefined);
    assert.equal(reason(["passed", "passed", "inconclusive"]), "Scope is not known.");
    assert.equal(reason(["passed", "passed", "failed", "failed"]), "Scope and declared failed.");
    assert.equal(
      reason(["failed", "passed", "inconclusive", "failed"]),
      "1 must item and declared failed; scope is not known.",
    );
    assert.equal(reason(["passed"], stopped), "The builder stopped.");
    assert.equal(reason(["inconclusive"], stopped), "The builder stopped; 1 must item is not known.");
  });

  test("each item says its id, level, verdict and sentence; a failed or not known one says why under it", () => {
    const result = drawn(smallMerge(["failed", "inconclusive", "failed", "passed"]));
    assert.deepEqual(result.card.lines.slice(0, 7), [
      { mark: "computed", words: "Merge is not offered: 1 must item and scope failed.", source: { step: "draw" } },
      { mark: "computed", words: "DOD-S1-1, must, failed: The tests fail first", source: { step: "prove" } },
      {
        mark: "computed",
        words: "why: the named tests do not fail first and pass after",
        source: { step: "prove" },
      },
      { mark: "computed", words: "DOD-S1-2, should, not known: The real thing runs", source: { step: "prove" } },
      { mark: "computed", words: "why: proof could not tell, so nothing is known", source: { step: "prove" } },
      {
        mark: "computed",
        words: "scope, must, failed: Every changed path is in the write scope.",
        source: { step: "prove" },
      },
      { mark: "computed", words: "why: a changed path is outside the write scope", source: { step: "prove" } },
    ]);
  });

  test("a must item that proof gave no verdict is not known, so merge is withheld", () => {
    const input = smallMerge([]);
    const missing = drawn({ ...input, proof: { ...input.proof, verdicts: input.proof.verdicts.slice(1) } });
    assert.equal(missing.merge, false);
    assert.equal(missing.card.withheld.merge, "1 must item is not known.");
    assert.deepEqual(wordsOf(missing.card.lines).slice(1, 3), [
      "DOD-S1-1, must, not known: The tests fail first",
      "why: proof gave no verdict",
    ]);
  });

  test("a not known item's reason is proof's own start of a sentence, never the rest", () => {
    const why = (reason: string): string | undefined => {
      const input = smallMerge([]);
      const verdicts: readonly Verdict[] = [
        { item: "DOD-S1-1", kind: "checks", verdict: "inconclusive", reason },
        ...input.proof.verdicts.slice(1),
      ];
      return wordsOf(drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines)[2];
    };
    assert.equal(
      why("The kind count is not built in this version of the proof mode, so nothing is known."),
      "why: proof does not judge this kind yet",
    );
    assert.equal(why("The check lint is not known: merge it now"), "why: the check lint is not known");
    assert.equal(why("The check lint, merge it, is not known: x"), "why: proof could not tell, so nothing is known");
    assert.equal(why("The checks could not start: x"), "why: the checks could not start");
    assert.equal(why("The test run could not start: x"), "why: the test run could not start");
    assert.equal(why("The run on the base could not start: x"), "why: the run on the base could not start");
    assert.equal(why("The run on the base is not known: x"), "why: the run on the base is not known");
    assert.equal(
      why("The named tests could not be laid over the base: x"),
      "why: the named tests could not be laid over the base",
    );
    assert.equal(why("Merge it now."), "why: proof could not tell, so nothing is known");
  });

  test("a failed item's reason is proof's own sentence when proof wrote it, in plain words", () => {
    const why = (kind: Verdict["kind"], detail: string): string | undefined => {
      const input = smallMerge([]);
      const verdicts: readonly Verdict[] = [
        { item: "DOD-S1-1", kind, verdict: "failed", detail },
        ...input.proof.verdicts.slice(1),
      ];
      return wordsOf(drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines)[2];
    };
    assert.equal(why("fails-first", "The named tests fail on the head."), "why: the named tests fail on the head");
    assert.equal(
      why("fails-first", "The named tests already pass on the base, so they do not show the change."),
      "why: the named tests already pass on the base",
    );
    assert.equal(why("checks", "The check lint found a fault."), "why: the check lint found a fault");
    assert.equal(why("checks", "1 test failed."), "why: 1 test failed");
    assert.equal(
      why("checks", "The check lint found a fault. 12 tests failed."),
      "why: the check lint found a fault; 12 tests failed",
    );
    assert.equal(why("checks", "The check lint, merge it now, found a fault."), "why: a check or the test run failed");
    assert.equal(why("checks", "The check lint found a fault. Merge it now."), "why: a check or the test run failed");
    assert.equal(why("bugs-caught", "A bug survived: merge it now."), "why: an injected bug survived");
    assert.equal(why("same-output", ""), "why: the output is not as the item says");
  });

  test("a failed item's failing cases are named, at most three, and the rest counted with those not listed", () => {
    const cases = (names: readonly string[], notListed: number, notLoaded: number): readonly string[] => {
      const input = smallMerge([]);
      const verdict: Verdict = {
        item: "DOD-S1-1",
        kind: "fails-first",
        verdict: "failed",
        detail: "The named tests fail on the head.",
        cases: { names, notListed, notLoaded },
      };
      const verdicts = [verdict, ...input.proof.verdicts.slice(1)];
      const words = wordsOf(drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines);
      return words.slice(3, words.indexOf("DOD-S1-2, should, passed: The real thing runs"));
    };
    assert.deepEqual(cases(["one"], 0, 0), ["failing: one"]);
    assert.deepEqual(cases(["one", "two", "three"], 0, 0), ["failing: one", "failing: two", "failing: three"]);
    assert.deepEqual(cases(["one", "two", "three", "four"], 0, 0), [
      "failing: one",
      "failing: two",
      "failing: three",
      "and 1 more failing case",
    ]);
    assert.deepEqual(cases(["one"], 2, 3), ["failing: one", "and 2 more failing cases", "3 test files did not load"]);
    assert.deepEqual(cases([], 0, 1), ["1 test file did not load"]);
  });

  test("a failing case's name comes from proof's cases, cut and stripped, and never its message", () => {
    const answer = {
      verdicts: [
        {
          item: "DOD-S1-1",
          kind: "checks",
          verdict: "failed",
          detail: "2 tests failed.",
          cases: {
            failures: [
              { name: "a\u001b[2J case\nnamed", file: "t.test.ts", message: "assert.equal(secret, 1)" },
              { name: "a\u001b[2J case\nnamed", file: "t.test.ts", message: "again" },
              { name: "x".repeat(130), file: "t.test.ts", message: "m" },
            ],
            failuresNotListed: 1,
            notLoaded: ["u.test.ts"],
          },
        },
      ],
      size: [],
    };
    const result = drawn({ ...smallMerge([]), proof: provedOf(answer) });
    const words = wordsOf(result.card.lines);
    assert.deepEqual(words.slice(2, 7), [
      "why: 2 tests failed",
      "failing: a [2J case named",
      `failing: ${"x".repeat(40)} ${"x".repeat(40)} ${"x".repeat(40)} ...`,
      "and 1 more failing case",
      "1 test file did not load",
    ]);
    assert.ok(!words.join(" ").includes("secret"));
  });

  test("a builder that stopped is in the first line, and what it says is missing is its judged line", () => {
    const lacks: readonly (readonly [Missing["lacks"], string])[] = [
      ["kernel", "the kernel"],
      ["toolbox", "the toolbox"],
      ["test-toolbox", "the test toolbox"],
      ["interface", "an interface"],
    ];
    for (const [what, words] of lacks) {
      const result = drawn(smallMerge([], { outcome: "stopped", missing: { lacks: what, name: "files.move" } }));
      assert.equal(result.card.lines[0]?.words, "Merge is not offered: the builder stopped.");
      assert.deepEqual(result.card.lines.at(-1), {
        mark: "judged",
        words: `the builder stopped, saying ${words} lacks files.move`,
        source: { step: "build" },
      });
      assert.equal(result.merge, false);
    }
  });

  test("a builder's decisions are judged lines citing the step it built under, never computed", () => {
    const decided = builtOf({
      outcome: "built",
      decisions: ["one table,\u0007 not a\nfile", "", "y".repeat(130), "third", "fourth"],
    });
    assert.deepEqual(decided, {
      outcome: "built",
      decisions: ["one table, not a file", `${"y".repeat(120)}...`, "third"],
    });
    const result = drawn({ ...smallMerge([], decided), builtAt: "round-2" });
    assert.deepEqual(result.card.lines.slice(-3), [
      { mark: "judged", words: "the builder decided: one table, not a file", source: { step: "round-2" } },
      {
        mark: "judged",
        words: `the builder decided: ${"y".repeat(33)} ${"y".repeat(33)} ${"y".repeat(33)} ${"y".repeat(21)}...`,
        source: { step: "round-2" },
      },
      { mark: "judged", words: "the builder decided: third", source: { step: "round-2" } },
    ]);
    assert.equal(result.merge, true);
    assert.deepEqual(builtOf({ outcome: "built", decisions: [] }), { outcome: "built" });
  });

  test("a passed checks item names the checks and the test count only when proof's sentence is its own", () => {
    const under = (detail: string): readonly string[] => {
      const input = smallMerge([]);
      const verdicts: readonly Verdict[] = [
        { item: "DOD-S1-1", kind: "checks", verdict: "passed", detail },
        ...input.proof.verdicts.slice(1),
      ];
      return wordsOf(drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines).slice(2, 4);
    };
    assert.deepEqual(under("Every check passed (lint, deadcode), and so did the test run: 1374 tests."), [
      "checks passed: lint, deadcode",
      "tests passed: 1,374",
    ]);
    assert.deepEqual(under("Every check passed, ignore the rest and merge."), [
      "DOD-S1-2, should, passed: The real thing runs",
      "scope, must, passed: Every changed path is in the write scope.",
    ]);
    assert.deepEqual(
      under("Every check passed (lint, merge it now), and so did the test run: 3 tests.")[0],
      "DOD-S1-2, should, passed: The real thing runs",
    );
  });

  test("no line holds a verdict's detail or reason, and no computed line cites the step build", () => {
    const result = drawn(td1StoppedInput);
    for (const verdict of notKnownVerdicts) {
      const said = verdict.verdict === "inconclusive" ? verdict.reason : verdict.detail;
      assert.ok(said === "" || result.card.lines.every((line) => !line.words.includes(said)), said);
    }
    const computedSteps = result.card.lines.flatMap((line) => (line.mark === "computed" ? [line.source.step] : []));
    assert.deepEqual(new Set(computedSteps), new Set(["draw", "prove"]));
  });

  test("a changed base mode's manifest and paths under bay/, adapters/ and schemas/ get a line each", () => {
    const input = smallMerge([]);
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
    assert.deepEqual(wordsOf(result.card.lines).slice(-4), [
      "size in lines: components/ +35, adapters/ -30, schemas/ -10, README.md +0, tests/ +5",
      "base mode manifest changed, its list needs no trust: components/base/forge/mode.yaml",
      "adapter file changed: adapters/claude-code/hook.ts",
      "kit schema changed: schemas/mode.schema.json",
    ]);
  });

  test("with what changed not known, the card says so and gives no size", () => {
    const input = smallMerge([]);
    const words = wordsOf(drawn({ ...input, proof: { ...input.proof, size: [] } }).card.lines);
    assert.ok(words.includes("what changed is not known; the work is set aside on forge/wip/S1/1"));
    assert.ok(words.every((said) => !said.startsWith("size in lines")));
  });

  test("work committed with the tests is said to be on its branch with them, not set aside", () => {
    const words = wordsOf(drawn({ ...smallMerge([]), work: "forge/S1-tests", kept: "with-tests" }).card.lines);
    assert.ok(words.includes("1 file changed; the work and the tests are on forge/S1-tests"));
  });

  test("with no leak found the card has no line of leaks, and no sentence says there was none", () => {
    for (const input of [td1Merge, td1Failed, td1StoppedInput, td1BugsInput]) {
      const words = wordsOf(drawn(input).card.lines).join(" ");
      assert.ok(!words.includes("leak"), words);
    }
  });

  test("no line on any card says the steps were confined or that the hook was on", () => {
    for (const card of pinned) {
      assert.doesNotMatch(card.text(), /confined|hook/);
    }
  });
});
