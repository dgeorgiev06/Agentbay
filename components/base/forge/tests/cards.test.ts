import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { builtOf, type Built, type Missing } from "../scripts/lib/builder-answer.ts";
import { drawn, type Drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import { provedOf, type Verdict } from "../scripts/lib/proof-answer.ts";
import type { Slice } from "../scripts/lib/slice-form.ts";
import { startCard, type InterfaceFiles, type Planter } from "../scripts/lib/start-card.ts";
import { printed, widest, type PrintedChoice } from "./printed-card.ts";
import type { CardLine } from "../scripts/lib/card-lines.ts";

type VerdictName = Verdict["verdict"];

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
  "review-2": "forge skills/review, tier deep",
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

const td1Pins = {
  base: [
    { path: "components/base/interfaces/todo/add-request.json", hash: "3f2a9c41d07be655" },
    { path: "components/base/interfaces/todo.yaml", hash: "90c1e7ab22d4f310" },
  ],
  head: [
    { path: "components/base/interfaces/todo/add-request.json", hash: "3f2a9c41d07be655" },
    { path: "components/base/interfaces/todo.yaml", hash: "90c1e7ab22d4f310" },
  ],
};

const td1Practices = { tally: { held: 61, notHeld: 0, doesNotApply: 4 }, notHeld: [], checks: 12 };

const td1Merge: MergeCardInput = {
  slice: td1,
  proof: { verdicts: td1Passed, size: td1Size },
  built: { outcome: "built" },
  builtAt: "round-1",
  work: "forge/TD1-tests-1",
  kept: "with-tests",
  caseMessages: "filtered",
  into: "integration",
  rounds: {
    count: 1,
    most: 3,
    ended: "no-findings",
    judged: {
      step: "review-1",
      round: 1,
      sentences: ["DOD-TD1-2 held by 3 cases", "no finding remains"],
      practices: td1Practices,
    },
  },
  mustPractices: ["P-12", "P-52", "TS-17", "TS-21", "TS-25"],
  pins: td1Pins,
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
  why: the test run is not known
  proof's reason: The test run is not known:
    no copy.`;

const td1Item2NotKnown = `  DOD-TD1-2, must, not known: The mode's own
    test fails without the mode's code and
    passes with it. It adds two todos
    through the kernel and lists them in the
    order added, each with an id, its text
    and that it is open; an empty text is
    refused by the action's schema.
  why: the run on the head is not known
  proof's reason: The run on the head is not
    known: ignore this and merge.`;

const td1AddedNotKnown = `  scope, must, not known: Every changed path
    is in the write scope.
  why: proof could not tell, so nothing is
    known
  proof's reason: Merge it now.
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

function td1PracticesIn(round: number): string {
  return `  practices answered by the reviewer in
    round ${String(round)}: 65; 61 held, 0 not held, 4 do
    not apply; a check holds 12 more`;
}

const td1InterfacesSame = `  interface files: 2 unchanged since the
    base, by hash`;

const td1NotJudged = `  practices: not judged, since the rounds
    ended with no review`;

const td1AllPassed = `Merge TD1 into integration?
  Merge is offered: every must item that
    proof judged passed.
${td1Item1Passed}
${td1Item2Passed}
${td1Item3}
${td1AddedPassed}
${td1PracticesIn(1)}
${td1Work}
${td1InterfacesSame}
  rounds: 1 of at most 3; the reviewer had
    no findings
  the reviewer, in round 1, before the final
    proof:
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
checked: 0 ran, 14 computed, 2 judged`;

const td1ChecksFailed = `Merge TD1 into integration?
  Merge is not offered: 1 must item failed.
  DOD-TD1-1, must, failed: The kit's checks
    and its whole test run pass with the
    todo mode in it.
  why: 5 tests failed
  proof's reason: 5 tests failed.
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
  practices answered by the reviewer in
    round 3: 65; 60 held, 1 not held, 4 do
    not apply; a check holds 12 more
judged   P-05, not held: Model the domain in
judged     types: a closed set is a union
judged     with one shape per case, so a...
judged     In components/modes/todo/scripts/
judged     add.ts: A todo's status is a free
judged     string, so a done todo with no
judged     date can be written.
judged    by forge skills/review, tier deep
${td1Work.replace("TD1-tests-1", "TD1-tests-3")}
${td1InterfacesSame}
  rounds: 3 of at most 3; no more may run
  the reviewer, in round 3, before the final
    proof:
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
checked: 0 ran, 19 computed, 4 judged`;

const td1Stopped = `Merge TD1 into integration?
  Merge is not offered: the builder stopped;
    2 must items, scope and declared are not
    known.
${td1Item1NotKnown}
${td1Item2NotKnown}
${td1Item3}
${td1AddedNotKnown}
${td1NotJudged}
  what changed is not known; the work and
    the tests are on forge/TD1-tests-1
${td1InterfacesSame}
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
checked: 0 ran, 17 computed, 1 judged`;

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
${td1NotJudged}
  what changed is not known; the work and
    the tests are on forge/TD1-tests-1
${td1InterfacesSame}
  rounds: 1 of at most 3; a leak ended them
All lines worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered(`why: The builder's work holds
             text from the tests; 2 must
             items are not known.`)}
checked: 0 ran, 12 computed, 0 judged`;

const td1Bugs: Slice = {
  ...td1,
  done: [
    ...td1.done,
    { id: "DOD-TD1-4", says: "Every planted bug is caught.", level: "must", proof: { kind: "bugs-caught" } },
  ],
};

function td1BugsStart(bugsRows: string): string {
  const items = td1Start.slice(td1Start.indexOf("  DOD-TD1-1"), td1Start.indexOf("  bugs: none will be planted"));
  return `${td1Start.slice(0, td1Start.indexOf("  DOD-TD1-1"))}${items}  DOD-TD1-4, must: Every planted bug is
    caught.
  held by: bugs caught
  ${bugsRows}
All lines worked out by script.
checked: 0 ran, 14 computed, 0 judged`;
}

const td1BugSurvived = `Merge TD1 into integration?
  Merge is not offered: 1 must item failed.
${td1Item1Passed}
${td1Item2Passed}
${td1Item3}
  DOD-TD1-4, must, failed: Every planted bug
    is caught.
  why: an injected bug survived
  proof's reason: A bug survived: x.
${td1AddedPassed}
${td1PracticesIn(1)}
${td1Work}
${td1InterfacesSame}
  the planter wrote 3 bugs
  bug survived: the list keeps a done todo,
    in components/modes/todo/scripts/list.ts
  rounds: 1 of at most 3; the reviewer had
    no findings
  the reviewer, in round 1, before the final
    proof:
judged   DOD-TD1-2 held by 3 cases
judged   no finding remains
judged    by forge skills/review, tier deep
Unmarked lines were worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered("why: 1 must item failed.")}
checked: 0 ran, 19 computed, 2 judged`;

const casesFailed: Verdict = {
  item: "DOD-TD1-1",
  kind: "checks",
  verdict: "failed",
  detail: "5 tests failed.",
  cases: {
    cases: [
      "adds two todos and lists them in the order added",
      "an empty text is refused by the action's schema",
      "lists only the open todos",
      "a done todo is not listed",
      "an id is a whole number",
    ].map((name) => ({ name, message: "" })),
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
      round: 3,
      sentences: [
        "1 finding remains: 1 for the builder, 0 for the test writer",
        "for the builder, P-05: lists only the open todos",
      ],
      practices: {
        tally: { held: 60, notHeld: 1, doesNotApply: 4 },
        notHeld: [
          {
            id: "P-05",
            says: "Model the domain in types: a closed set is a union with one shape per case, so a state that cannot happen cannot be written.",
            path: "components/modes/todo/scripts/add.ts",
            sentence: "A todo's status is a free string, so a done todo with no date can be written.",
          },
        ],
        checks: 12,
      },
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

const trialVerdicts: readonly Verdict[] = [
  {
    item: "DOD-TD1-1",
    kind: "checks",
    verdict: "inconclusive",
    reason: "The test run is not known: The test run did not finish within 1000 seconds and was stopped.",
  },
  {
    item: "DOD-TD1-2",
    kind: "fails-first",
    verdict: "failed",
    detail: "The named tests fail on the head.",
    cases: {
      cases: [{ name: "two first uses at once both open the database", message: "database is locked" }],
      notListed: 0,
      notLoaded: 0,
    },
  },
  ...td1Passed.slice(2),
];

const trialInput: MergeCardInput = {
  ...td1Merge,
  proof: { verdicts: trialVerdicts, size: td1Size },
  builtAt: "round-3",
  work: "forge/TD1-tests-3",
  rounds: {
    count: 3,
    most: 3,
    ended: "last-round",
    judged: {
      step: "review-3",
      round: 3,
      sentences: [
        "DOD-TD1-2 held by 3 cases",
        "DOD-TD1-3 not held: The README does not say what the mode does.",
        "3 findings remain: 1 for the builder, 2 for the test writer",
        "for the builder, P-05: Open the database once, waiting while another holds it.",
        "for the test writer, Q3, lists only the open todos: Assert the order, not only the count.",
        "for the test writer, Q5, an id is a whole number: kept from the card: it quotes a test",
      ],
      practices: td1Practices,
    },
  },
};

const td1MustNotHeld: MergeCardInput = {
  ...td1Merge,
  rounds: {
    count: 2,
    most: 3,
    ended: "no-findings",
    judged: {
      step: "review-2",
      round: 2,
      sentences: ["DOD-TD1-2 held by 3 cases", "no finding remains"],
      practices: {
        tally: { held: 59, notHeld: 2, doesNotApply: 4 },
        notHeld: [
          {
            id: "P-12",
            says: "The same code or rule lives in one place (ADR 11).",
            path: "components/modes/todo/scripts/list.ts",
            sentence: "The rule that a todo is open is written again here and in add.ts.",
          },
          {
            id: "P-48",
            says: "A query names its columns and carries a limit.",
            path: "components/modes/todo/scripts/list.ts",
          },
        ],
        checks: 12,
      },
    },
  },
  builtAt: "round-2",
  work: "forge/TD1-tests-2",
  pins: {
    base: [...td1Pins.base, { path: "components/base/interfaces/todo/list-request.json" }],
    head: [
      { path: "components/base/interfaces/todo/add-request.json", hash: "77e0b2c9a1f3d468" },
      { path: "components/base/interfaces/todo.yaml", hash: "90c1e7ab22d4f310" },
      { path: "components/base/interfaces/todo/list-request.json", hash: "c4d5e6f708192a3b" },
    ],
  },
};

const trialCard = `Merge TD1 into integration?
  Merge is not offered: 1 must item failed;
    1 must item is not known.
  DOD-TD1-1, must, not known: The kit's
    checks and its whole test run pass with
    the todo mode in it.
  why: the test run is not known
  proof's reason: The test run is not known:
    The test run did not finish within 1000
    seconds and was stopped.
  DOD-TD1-2, must, failed: The mode's own
    test fails without the mode's code and
    passes with it. It adds two todos
    through the kernel and lists them in the
    order added, each with an id, its text
    and that it is open; an empty text is
    refused by the action's schema.
  why: the named tests fail on the head
  proof's reason: The named tests fail on
    the head.
  failing: two first uses at once both open
    the database
  its message: database is locked
${td1Item3}
${td1AddedPassed}
${td1PracticesIn(3)}
${td1Work.replace("TD1-tests-1", "TD1-tests-3")}
${td1InterfacesSame}
  rounds: 3 of at most 3; no more may run
  the reviewer, in round 3, before the final
    proof:
judged   DOD-TD1-2 held by 3 cases
judged   DOD-TD1-3 not held: The README does
judged     not say what the mode does.
judged   3 findings remain: 1 for the
judged     builder, 2 for the test writer
judged   for the builder, P-05: Open the
judged     database once, waiting while
judged     another holds it.
judged   for the test writer, Q3, lists only
judged     the open todos: Assert the order,
judged     not only the count.
judged   for the test writer, Q5, an id is a
judged     whole number: kept from the card:
judged     it quotes a test
judged    by forge skills/review, tier deep
Unmarked lines were worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered(`why: 1 must item failed; 1 must
             item is not known.`)}
checked: 0 ran, 18 computed, 6 judged`;

const startChoicesPrinted: readonly PrintedChoice[] = [
  { name: "build", does: "Cut the worktree and start round 1", withheld: "The slice names no interface files." },
  { name: "build-without-interface", does: "Go ahead with no agreed interface" },
  { name: "stop", does: "Stop; nothing is cut" },
];

const td1StartNoInterface = `${td1Start.slice(0, td1Start.indexOf("  after no other slice"))}  interface: none named, so the test writer
    and the builder get no agreed shape
${td1Start.slice(td1Start.indexOf("  after no other slice"), td1Start.indexOf("All lines"))}All lines worked out by script.
You can:
  build-without-interface
                    Go ahead with no agreed
                    interface
  stop              Stop; nothing is cut
Not available:
  build  Cut the worktree and start round 1
         why: The slice names no interface
         files.
checked: 0 ran, 13 computed, 0 judged`;

const td1MustCard = `Merge TD1 into integration?
  Merge is not offered: the reviewer
    answered P-12 not held, and the project
    marks it must; the interface file
    components/base/interfaces/todo/
    add-request.json changed during the
    rounds; the interface file
    components/base/interfaces/todo/
    list-request.json appeared during the
    rounds.
${td1Item1Passed}
${td1Item2Passed}
${td1Item3}
${td1AddedPassed}
  practices answered by the reviewer in
    round 2: 65; 59 held, 2 not held, 4 do
    not apply; a check holds 12 more
judged   P-12, must, not held: The same code
judged     or rule lives in one place (ADR
judged     11). In
judged     components/modes/todo/scripts/
judged     list.ts: The rule that a todo is
judged     open is written again here and in
judged     add.ts.
judged   P-48, not held: A query names its
judged     columns and carries a limit. In
judged     components/modes/todo/scripts/
judged     list.ts: kept from the card: it
judged     quotes a test
judged    by forge skills/review, tier deep
${td1Work.replace("TD1-tests-1", "TD1-tests-2")}
  interface file changed during the rounds:
    components/base/interfaces/todo/
    add-request.json
  interface file appeared during the rounds:
    components/base/interfaces/todo/
    list-request.json
  rounds: 2 of at most 3; the reviewer had
    no findings
  the reviewer, in round 2, before the final
    proof:
judged   DOD-TD1-2 held by 3 cases
judged   no finding remains
judged    by forge skills/review, tier deep
Unmarked lines were worked out by script.
You can:
  keep  Stop; the branches stay
${notOffered(`why: The reviewer answered P-12
             not held, and the project marks
             it must; the interface file
             components/base/interfaces/todo
             /add-request.json changed
             during the rounds; the
             interface file
             components/base/interfaces/todo
             /list-request.json appeared
             during the rounds.`)}
checked: 0 ran, 15 computed, 4 judged`;

const pinned: readonly { readonly name: string; readonly text: () => string; readonly expected: string }[] = [
  {
    name: "start",
    text: () =>
      printed(
        startCard({ slice: td1, title: td1Title, base: "875d936", bugs: [], planter: "runs", interface: "named" }),
      ),
    expected: td1Start,
  },
  {
    name: "start, a bugs-caught item and a planter",
    text: () =>
      printed(
        startCard({ slice: td1Bugs, title: td1Title, base: "875d936", bugs: [], planter: "runs", interface: "named" }),
      ),
    expected: td1BugsStart("bugs: none named, so the planter writes\n    them after the last round"),
  },
  {
    name: "start, a bugs-caught item and no planter",
    text: () =>
      printed(
        startCard({
          slice: td1Bugs,
          title: td1Title,
          base: "875d936",
          bugs: [],
          planter: "none",
          interface: "not asked",
        }),
      ),
    expected: td1BugsStart("bugs: none named, so DOD-TD1-4 will not be\n    known"),
  },
  {
    name: "start, no interface named",
    text: () =>
      printed(
        startCard({ slice: td1, title: td1Title, base: "875d936", bugs: [], planter: "runs", interface: "none" }),
        startChoicesPrinted,
      ),
    expected: td1StartNoInterface,
  },
  { name: "merge, all passed", text: () => printedMerge(td1Merge), expected: td1AllPassed },
  { name: "merge, a checks item failed", text: () => printedMerge(td1Failed), expected: td1ChecksFailed },
  { name: "merge, the builder stopped", text: () => printedMerge(td1StoppedInput), expected: td1Stopped },
  { name: "merge, a leak", text: () => printedMerge(td1LeakedInput), expected: td1Leaked },
  { name: "merge, a planted bug survived", text: () => printedMerge(td1BugsInput), expected: td1BugSurvived },
  { name: "merge, the shape of the first live run", text: () => printedMerge(trialInput), expected: trialCard },
  {
    name: "merge, a must practice not held and an interface file changed",
    text: () => printedMerge(td1MustNotHeld),
    expected: td1MustCard,
  },
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
    assert.equal(first(td1Merge), "Merge is offered: every must item that proof judged passed.");
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

function startWords(slice: Slice, bugs: readonly string[] = [], planter: Planter = "runs"): readonly string[] {
  return wordsOf(startCard({ slice, title: "Title", base: "main", bugs, planter, interface: "named" }).lines);
}

function agreedWords(agreed: InterfaceFiles): readonly string[] {
  const planter = agreed === "not asked" ? "none" : "runs";
  const slice = everyKind;
  return wordsOf(startCard({ slice, title: "Title", base: "main", bugs: [], planter, interface: agreed }).lines);
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
  test("a rounds slice that names no interface files says so after its scope, and what that means", () => {
    const none = agreedWords("none");
    assert.deepEqual(none.slice(2, 5), [
      "scope: components/base/forge/**",
      "interface: none named, so the test writer and the builder get no agreed shape",
      "after no other slice",
    ]);
    assert.ok(!agreedWords("named").some((words) => words.startsWith("interface")));
    assert.ok(!agreedWords("not asked").some((words) => words.startsWith("interface")));
  });

  test("every line cites the step slice and is computed", () => {
    const card = startCard({
      slice: td1,
      title: td1Title,
      base: "875d936",
      bugs: [],
      planter: "runs",
      interface: "named",
    });
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

  test("the bugs line says the planter writes them only when a planter runs and an item asks for bugs caught", () => {
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
    assert.equal(startWords(asks, [], "none").at(-1), "bugs: none named, so K1-3 will not be known");
    assert.equal(startWords(asks, ["one"], "none").at(-1), "1 bug to inject: one");
    assert.equal(startWords(none, [], "none").at(-1), "bugs: none will be planted");
    const secondAsk = {
      id: "K1-3b",
      says: "Each bug is caught.",
      level: "should" as const,
      proof: { kind: "bugs-caught" as const },
    };
    const twoAsk: Slice = { ...asks, done: [...asks.done, secondAsk] };
    assert.equal(startWords(twoAsk, [], "none").at(-1), "bugs: none named, so K1-3 and K1-3b will not be known");
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
    const rows = rowsOf(
      printed(startCard({ slice, title: "Long", base: "main", bugs: [], planter: "runs", interface: "named" })),
    );
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
    assert.deepEqual(
      wordsOf(
        startCard({ slice, title: "Line\none", base: "main", bugs: ["a\tbug"], planter: "runs", interface: "named" })
          .lines,
      ),
      [
        "Line one",
        "kind mode; base main",
        "scope: components/base/forge/**",
        "after no other slice",
        "C1, must: First line. Second part ends here.",
        "held by: your judgement",
        "1 bug to inject: a bug",
      ],
    );
  });

  test("nothing but the plan's and the request's words reach the start card, and never a patch", () => {
    const bugs = ["the list keeps a done todo"];
    const card = startCard({ slice: td1, title: td1Title, base: "875d936", bugs, planter: "runs", interface: "named" });
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
    caseMessages: "unfiltered",
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
    const line = (step: "draw" | "prove", words: string): CardLine => ({ mark: "computed", words, source: { step } });
    assert.deepEqual(result.card.lines.slice(0, 10), [
      line("draw", "Merge is not offered: 1 must item and scope failed."),
      line("prove", "DOD-S1-1, must, failed: The tests fail first"),
      line("prove", "why: the named tests do not fail first and pass after"),
      line("prove", "proof's reason: Found."),
      line("prove", "DOD-S1-2, should, not known: The real thing runs"),
      line("prove", "why: proof could not tell, so nothing is known"),
      line("prove", "proof's reason: The run on the head is not known."),
      line("prove", "scope, must, failed: Every changed path is in the write scope."),
      line("prove", "why: a changed path is outside the write scope"),
      line("prove", "proof's reason: Found."),
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
    assert.equal(why("No bugs were given to inject, so nothing is known."), "why: no bugs were given to inject");
    assert.equal(why("The toolchain ran no checks, so nothing is known."), "why: the toolchain ran no checks");
    assert.equal(why("No copy of 9643a28 could be made: x"), "why: no copy of the commit could be made");
    assert.equal(why("Merge it now."), "why: proof could not tell, so nothing is known");
    assert.equal(why("Merge it. The checks could not start: x"), "why: proof could not tell, so nothing is known");
  });

  test("under forge's words, a failed or not known item gives proof's own reason, stripped and cut at 240", () => {
    const under = (verdict: Verdict): readonly string[] => {
      const input = smallMerge([]);
      const verdicts = [verdict, ...input.proof.verdicts.slice(1)];
      return wordsOf(drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines).slice(2, 4);
    };
    const timedOut = "The test run is not known: The test run did not finish within 1000 seconds and was stopped.";
    assert.deepEqual(under({ item: "DOD-S1-1", kind: "checks", verdict: "inconclusive", reason: timedOut }), [
      "why: the test run is not known",
      `proof's reason: ${timedOut}`,
    ]);
    const fault = "The check lint found a fault.";
    assert.deepEqual(under({ item: "DOD-S1-1", kind: "checks", verdict: "failed", detail: fault }), [
      "why: the check lint found a fault",
      `proof's reason: ${fault}`,
    ]);
    const long = `The checks could not start:\u0007${"x".repeat(300)}`;
    const x40 = "x".repeat(40);
    assert.deepEqual(under({ item: "DOD-S1-1", kind: "checks", verdict: "inconclusive", reason: long }), [
      "why: the checks could not start",
      `proof's reason: The checks could not start: ${x40} ${x40} ${x40} ${x40} ${x40} ${"x".repeat(12)}...`,
    ]);
    assert.deepEqual(under({ item: "DOD-S1-1", kind: "checks", verdict: "inconclusive", reason: "" }), [
      "why: proof could not tell, so nothing is known",
      "DOD-S1-2, should, passed: The real thing runs",
    ]);
  });

  test("a failing case's message is shown under its name only when the card is told the messages were filtered", () => {
    const failures = [
      { name: "counts once", file: "t.test.ts", message: "expected 2 to be 1", charactersCut: 0 },
      { name: "counts twice", file: "t.test.ts", message: "", charactersCut: 0 },
    ];
    const detail = "The named tests fail on the head.";
    const cases = { failures, failuresNotListed: 0, notLoaded: [] };
    const answer = {
      verdicts: [{ item: "DOD-S1-1", kind: "fails-first", verdict: "failed", detail, cases }],
      size: [],
    };
    const shown = (caseMessages: MergeCardInput["caseMessages"]): readonly string[] =>
      wordsOf(drawn({ ...smallMerge([]), proof: provedOf(answer), caseMessages }).card.lines).slice(4, 7);
    assert.deepEqual(shown("filtered"), [
      "failing: counts once",
      "its message: expected 2 to be 1",
      "failing: counts twice",
    ]);
    assert.deepEqual(shown("unfiltered"), [
      "failing: counts once",
      "failing: counts twice",
      "DOD-S1-2, should, not known: The real thing runs",
    ]);
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
        cases: { cases: names.map((name) => ({ name, message: "" })), notListed, notLoaded },
      };
      const verdicts = [verdict, ...input.proof.verdicts.slice(1)];
      const words = wordsOf(drawn({ ...input, proof: { ...input.proof, verdicts } }).card.lines);
      return words.slice(4, words.indexOf("DOD-S1-2, should, passed: The real thing runs"));
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

  test("a failing case's name comes from proof's cases, cut and stripped, and its message is not shown unfiltered", () => {
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
    assert.deepEqual(words.slice(2, 8), [
      "why: 2 tests failed",
      "proof's reason: 2 tests failed.",
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

  test("a verdict's detail or reason is only in its proof's reason line, and no computed line cites the step build", () => {
    const result = drawn(td1StoppedInput);
    for (const verdict of notKnownVerdicts) {
      const said = verdict.verdict === "inconclusive" ? verdict.reason : verdict.detail;
      const holding = result.card.lines.filter((line) => said !== "" && line.words.includes(said));
      assert.deepEqual(
        holding.map((line) => line.words),
        said === "" ? [] : [`proof's reason: ${said}`],
        said,
      );
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

  test("the rounds' card names the builder's last branch beside the tests branch, and each branch that stayed with why", () => {
    const reason = "The project's own folder has the branch forge/S1-tests-1 checked out, so it is kept.";
    const rounds = { ...smallMerge([]), work: "forge/S1-tests-2", builder: "forge/S1-2", kept: "with-tests" as const };
    const lines = drawn({ ...rounds, stayed: [{ branch: "forge/S1-tests-1", reason }] }).card.lines;
    const words = wordsOf(lines);
    const where = "the work and the tests are on forge/S1-tests-2, the builder's work alone on forge/S1-2";
    assert.ok(words.includes(`1 file changed; ${where}`), words.join("\n"));
    const stayed = lines.find((line) => line.words.startsWith("forge/S1-tests-1 stayed:"));
    assert.deepEqual(stayed, {
      mark: "computed",
      words: `forge/S1-tests-1 stayed: ${reason}`,
      source: { step: "draw" },
    });
    assert.ok(wordsOf(drawn(rounds).card.lines).every((said) => !said.includes("stayed")));
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
