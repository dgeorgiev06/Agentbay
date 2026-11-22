import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf } from "../../../../bay/sdk.ts";
import type { Gate } from "../scripts/lib/gate.ts";
import { provedOf } from "../scripts/lib/proof-answer.ts";
import { sliceOf, type Slice } from "../scripts/lib/slice-form.ts";
import { aloneWords, waveAnswer, type Alone, type Joined, type WaveChecks } from "../scripts/lib/wave-answer.ts";
import { waveDrawn, type WaveCardInput } from "../scripts/lib/wave-card.ts";
import { ownProofReason, type Settled } from "../scripts/lib/wave-standing.ts";
import { factOf, type Fact, type Proved } from "./kit-copy.ts";
import { checksFailed, checksPassed, ownFailed, ownPassed, plannedSlice } from "./wave-run.ts";

const head = "3710c98d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b";

function own(name: string): Slice {
  const slice = sliceOf(fieldsOf(plannedSlice(name)).slice);
  return { ...slice, done: slice.done.filter((item) => item.proof?.kind !== "checks") };
}

function checksOf(name: string): Slice {
  const slice = sliceOf(fieldsOf(plannedSlice(name)).slice);
  return { ...slice, done: slice.done.filter((item) => item.proof?.kind === "checks") };
}

const reviewed = {
  step: "review-1",
  round: 1,
  sentences: ["DOD-TD1-1 held by 2 cases", "no finding remains"],
  reviewed: { held: 1, notHeld: 0, remaining: 0 },
  practices: {
    tally: { held: 64, notHeld: 1, doesNotApply: 0 },
    notHeld: [{ id: "P-12", says: "Functions stay small.", path: "src/count.ts", sentence: "count is 40 lines." }],
    checks: 12,
  },
};

function settled(name: string, proof: Proved, reason?: string): Settled {
  const shown = {
    name,
    title: `The ${name.toLowerCase()} mode counts what was added`,
    base: head,
    head,
    work: `forge/${name}-tests-1`,
    builder: `forge/${name}`,
    own: own(name),
    checks: checksOf(name),
    proof: provedOf(proof),
    rounds: {
      count: 1,
      most: 3,
      ended: "no-findings" as const,
      judged: reviewed,
    },
    leaks: [],
    built: { outcome: "built" as const, decisions: [`${name} counts in memory`] },
    builtAt: "round-1",
    pins: {
      base: [{ path: "a.json", hash: "0123456789abcdef" }],
      head: [{ path: "a.json", hash: "0123456789abcdef" }],
    },
    bugs: { planted: 0, survived: [] },
    stayed: [],
  };
  return reason === undefined ? shown : { ...shown, reason };
}

const combined: Joined = { kind: "combined", head, branch: "forge/wave-1", merged: ["TD1"] };

const passedChecks: WaveChecks = {
  kind: "asked",
  slice: sliceOf({
    name: "wave-1",
    kind: "mode",
    scope: [],
    after: [],
    done: [{ id: "checks", says: "The checks and the whole test run pass.", level: "must", proof: { kind: "checks" } }],
  }),
  proof: provedOf(checksPassed("checks")),
};

const oneFailing: WaveCardInput = {
  wave: 1,
  into: "integration",
  slices: [settled("TD1", ownPassed("TD1")), settled("TD2", ownFailed("TD2"), "1 must item failed.")],
  joined: combined,
  checks: passedChecks,
  alone: [],
  must: [],
};

type Said = readonly [section: string, short: boolean, about: string, mark: string, step: string, words: string];

function mergeFact([section, short, about, mark, step, words]: Said): Fact {
  return { section, short, about, mark, words, step };
}

const oneFailingFacts: readonly Fact[] = (
  [
    ["problems", false, "", "computed", "draw", "TD2 is left out: 1 must item failed. Its branches stay."],
    [
      "problems",
      false,
      "",
      "computed",
      "draw",
      "TD2: the must item DOD-TD2-1 failed, as the named tests fail on the head.",
    ],
    ["what", true, "", "computed", "draw", "In the combined head: 1 of 2 slices."],
    ["what", true, "", "computed", "draw", "1 file changed."],
    ["what", true, "", "computed", "draw", "The work is on forge/wave-1."],
    [
      "what",
      false,
      "the combined head",
      "computed",
      "draw",
      "The combined head is 3710c98d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b on forge/wave-1, with TD1 merged in plan order.",
    ],
    [
      "what",
      false,
      "slice TD1",
      "computed",
      "draw",
      "TD1 is in the combined head; the work and the tests are on forge/TD1-tests-1, the builder's work alone on forge/TD1.",
    ],
    ["what", false, "slice TD1", "computed", "draw", "It changed 1 file."],
    ["what", false, "slice TD1", "computed", "draw", "Interface files: 1 unchanged since the base, by hash."],
    ["what", false, "slice TD1", "computed", "draw", "Rounds: 1 of at most 3; the reviewer had no findings."],
    ["what", false, "slice TD1", "judged", "round-1", "The builder decided: TD1 counts in memory."],
    [
      "what",
      false,
      "slice TD2",
      "computed",
      "draw",
      "TD2 is left out; the work and the tests are on forge/TD2-tests-1, the builder's work alone on forge/TD2.",
    ],
    ["what", false, "slice TD2", "computed", "draw", "It changed 1 file."],
    ["what", false, "slice TD2", "computed", "draw", "Interface files: 1 unchanged since the base, by hash."],
    ["what", false, "slice TD2", "computed", "draw", "Rounds: 1 of at most 3; the reviewer had no findings."],
    ["what", false, "slice TD2", "judged", "round-1", "The builder decided: TD2 counts in memory."],
    ["checks", true, "", "computed", "draw", "The checks passed; 40 tests passed."],
    ["checks", true, "", "computed", "draw", "Review step: 2 of 2 conditions held, 0 findings left."],
    ["checks", false, "the checks on the slices combined", "computed", "prove", "The must item checks passed."],
    ["checks", false, "the checks on the slices combined", "computed", "prove", "Checks passed: typecheck, lint."],
    ["checks", false, "the checks on the slices combined", "computed", "prove", "Tests passed: 40."],
    ["checks", false, "TD1's own proof", "computed", "draw", "The must item DOD-TD1-1 passed."],
    [
      "checks",
      false,
      "TD1's own proof",
      "computed",
      "draw",
      "The must item scope passed: Every changed path is in the write scope.",
    ],
    [
      "checks",
      false,
      "TD1's own proof",
      "computed",
      "draw",
      "The must item declared passed: What changed is as declared.",
    ],
    [
      "checks",
      false,
      "TD1's review",
      "computed",
      "draw",
      "Practices answered by the reviewer in round 1: 65; 64 held, 1 not held, 0 do not apply; a check holds 12 more.",
    ],
    [
      "checks",
      false,
      "TD1's review",
      "judged",
      "review-1",
      "P-12, not held: Functions stay small. In src/count.ts: count is 40 lines.",
    ],
    [
      "checks",
      false,
      "TD1's review",
      "computed",
      "draw",
      "The review step, in round 1, before the final proof, wrote these.",
    ],
    ["checks", false, "TD1's review", "judged", "review-1", "DOD-TD1-1 held by 2 cases."],
    ["checks", false, "TD1's review", "judged", "review-1", "No finding remains."],
    ["checks", false, "TD2's own proof", "computed", "draw", "The must item DOD-TD2-1 failed."],
    ["checks", false, "TD2's own proof", "computed", "draw", "The reason: the named tests fail on the head."],
    ["checks", false, "TD2's own proof", "computed", "draw", "Proof's reason: The named tests fail on the head."],
    [
      "checks",
      false,
      "TD2's own proof",
      "computed",
      "draw",
      "The must item scope passed: Every changed path is in the write scope.",
    ],
    [
      "checks",
      false,
      "TD2's own proof",
      "computed",
      "draw",
      "The must item declared passed: What changed is as declared.",
    ],
    [
      "checks",
      false,
      "TD2's review",
      "computed",
      "draw",
      "Practices answered by the reviewer in round 1: 65; 64 held, 1 not held, 0 do not apply; a check holds 12 more.",
    ],
    [
      "checks",
      false,
      "TD2's review",
      "judged",
      "review-1",
      "P-12, not held: Functions stay small. In src/count.ts: count is 40 lines.",
    ],
    [
      "checks",
      false,
      "TD2's review",
      "computed",
      "draw",
      "The review step, in round 1, before the final proof, wrote these.",
    ],
    ["checks", false, "TD2's review", "judged", "review-1", "DOD-TD1-1 held by 2 cases."],
    ["checks", false, "TD2's review", "judged", "review-1", "No finding remains."],
  ] satisfies readonly Said[]
).map(mergeFact);

describe("the wave's merge screen", () => {
  test("two slices, one failing its own proof: these facts, in this order", () => {
    const drawn = waveDrawn(oneFailing);
    assert.equal(drawn.merge, true);
    assert.deepEqual(drawn.card.withheld, {});
    assert.equal(drawn.card.title, "Merge wave 1 into integration?");
    assert.deepEqual(
      drawn.card.lines.map((line) => factOf({ ...line })),
      oneFailingFacts,
    );
  });

  test("every failing slice is named in problems with its reason, never only the first, and merge stays offered for the rest", () => {
    const three = [
      settled("TD1", ownFailed("TD1"), "1 must item failed."),
      settled("TD2", ownPassed("TD2"), "the builder stopped."),
      settled("TD3", ownPassed("TD3")),
    ];
    assert.deepEqual(waveAnswer(three, { ...combined, merged: ["TD3"] }, { checks: passedChecks }), { offered: true });
    const drawn = waveDrawn({ ...oneFailing, slices: three });
    assert.deepEqual(
      drawn.card.lines.filter((line) => line.section === "problems").map((line) => line.words),
      [
        "TD1 is left out: 1 must item failed. Its branches stay.",
        "TD1: the must item DOD-TD1-1 failed, as the named tests fail on the head.",
        "TD2 is left out: the builder stopped. Its branches stay.",
      ],
    );
  });

  test("no fact and no reason holds a slice's title or a planned item's words: the planner wrote them", () => {
    const failing = settled("TD2", ownFailed("TD2"), "1 must item failed.");
    const drawn = waveDrawn({ ...oneFailing, slices: [failing], joined: { kind: "nothing to join" } });
    const said = [...drawn.card.lines.map((line) => line.words), drawn.card.withheld.merge ?? ""].join("\n");
    assert.ok(!said.includes(failing.title), said);
    assert.ok(!said.includes("What was added is counted."), said);
  });
});

function alone(name: string, proved: Proved): Alone {
  return { name, slice: checksOf(name), proof: provedOf(proved) };
}

describe("naming the slice that breaks the suite", () => {
  test("a slice that fails the checks alone is named as the breaker, one or more", () => {
    assert.deepEqual(aloneWords([alone("CA", checksPassed("DOD-CA-2")), alone("CB", checksFailed("DOD-CB-2", "x"))]), [
      "CB fails the checks alone, so its work breaks the suite",
    ]);
    assert.deepEqual(
      aloneWords([alone("CA", checksFailed("DOD-CA-2", "x")), alone("CB", checksFailed("DOD-CB-2", "y"))]),
      ["CA and CB fail the checks alone, so their work breaks the suite"],
    );
  });

  test("when each passes alone, only the combination fails; a solo proof with no verdict is not known", () => {
    assert.deepEqual(aloneWords([alone("CA", checksPassed("DOD-CA-2")), alone("CB", checksPassed("DOD-CB-2"))]), [
      "each slice passes the checks alone; only their combination fails them",
    ]);
    const silent = { ...alone("CB", checksPassed("DOD-CB-2")), proof: { verdicts: [], size: [] } };
    assert.deepEqual(aloneWords([alone("CA", checksPassed("DOD-CA-2")), silent]), ["not known alone: CB"]);
    assert.deepEqual(aloneWords([]), []);
  });
});

describe("the wave's answer", () => {
  const two = [settled("TD1", ownPassed("TD1")), settled("TD2", ownPassed("TD2"))];

  test("merge is withheld when the checks fail or are not known on the combined head", () => {
    const failing: WaveChecks = { ...passedChecks, proof: provedOf(checksFailed("checks", "x")) };
    assert.deepEqual(waveAnswer(two, combined, { checks: failing }), {
      offered: false,
      reason: "the wave's checks failed on the slices combined.",
    });
    const unknown: WaveChecks = { ...passedChecks, proof: { verdicts: [], size: [] } };
    assert.equal(waveAnswer(two, combined, { checks: unknown }).offered, false);
    assert.equal(waveAnswer(two, combined, { checks: { kind: "not asked" } }).offered, false);
  });

  test("a merge that does not apply names both slices, and no slice passing names that", () => {
    const conflict: Joined = { kind: "conflict", slice: "TD2", onto: ["TD1"], reason: "It conflicts in a.ts." };
    assert.deepEqual(waveAnswer(two, conflict, { checks: { kind: "not asked" } }), {
      offered: false,
      reason: "TD2 does not merge cleanly onto TD1 in the combined head.",
    });
    const none = [settled("TD1", ownFailed("TD1"), "1 must item failed.")];
    assert.deepEqual(waveAnswer(none, { kind: "nothing to join" }, { checks: { kind: "not asked" } }), {
      offered: false,
      reason: "no slice passed its own proof; left out: TD1, as its own proof did not pass.",
    });
    const drawn = waveDrawn({ ...oneFailing, joined: conflict, checks: { kind: "not asked" } });
    assert.ok(
      drawn.card.lines.some(
        (line) =>
          line.section === "problems" &&
          line.words === "TD2 does not merge cleanly onto TD1 in the combined head: It conflicts in a.ts.",
      ),
    );
  });
});

describe("which slices go into the combined head", () => {
  const state = {
    round: 1,
    stage: "reviewed" as const,
    done: true,
    base: head,
    built: { outcome: "built" as const },
    builder: { branch: "forge/TD1", commit: head },
    head,
    branch: "forge/TD1-tests-1",
    declared: null,
    tests: [],
    verdicts: [],
    failing: { items: [], cases: [], withheld: 0, notListed: 0, notLoaded: [] },
    toBuilder: [],
    toTests: 0,
    conditions: [],
    remaining: [],
    leaks: [],
    reviewedAt: "review-1",
  };
  const pins = {
    base: [{ path: "a.json", hash: "0123456789abcdef" }],
    head: [{ path: "a.json", hash: "0123456789abcdef" }],
  };
  const parts = { own: own("TD1"), proof: provedOf(ownPassed("TD1")), state, pins, must: ["P-12"] };

  test("a slice whose own proof passed goes in, though its checks items have no verdict yet", () => {
    assert.equal(ownProofReason(parts), undefined);
  });

  test("a failed must item, a stopped builder, a leak, a must practice not held and a changed interface file each keep it out", () => {
    assert.equal(ownProofReason({ ...parts, proof: provedOf(ownFailed("TD1")) }), "1 must item failed.");
    const stopped = {
      ...state,
      built: { outcome: "stopped" as const, missing: { lacks: "kernel" as const, name: "x" } },
    };
    assert.equal(ownProofReason({ ...parts, state: stopped }), "the builder stopped.");
    const leaked = { ...state, leaks: [{ kind: "mark-in-answer" as const }] };
    assert.equal(ownProofReason({ ...parts, state: leaked }), "the builder's work holds text from the tests.");
    const practices = {
      tally: { held: 1, notHeld: 1, doesNotApply: 0 },
      notHeld: [{ id: "P-12", says: "", path: "a.ts" }],
      checks: 0,
    };
    assert.match(ownProofReason({ ...parts, state: { ...state, practices } }) ?? "", /answered P-12 not held/);
    const changed = { ...pins, head: [{ path: "a.json", hash: "fedcba9876543210" }] };
    assert.match(ownProofReason({ ...parts, pins: changed }) ?? "", /a\.json changed during the rounds/);
  });
});

describe("the wave's merge card under the mode gate", () => {
  const td1: Gate = { gate: "mode", mode: "td1", folder: "components/modes/td1" };
  const scope = (verdict: string): Proved["verdicts"][number] =>
    verdict === "passed"
      ? { item: "scope", kind: "in-scope", verdict, detail: "It held." }
      : { item: "scope", kind: "in-scope", verdict, reason: "x", detail: "x" };
  const checksWith = (verdicts: Proved["verdicts"]): WaveChecks => ({
    ...passedChecks,
    proof: provedOf({ ...checksPassed("checks"), verdicts: [...checksPassed("checks").verdicts, ...verdicts] }),
  });
  const ownWithoutScope = {
    ...ownPassed("TD1"),
    verdicts: ownPassed("TD1").verdicts.filter((each) => fieldsOf(each).item !== "scope"),
  };
  const input = (checks: WaveChecks, slice: Settled): WaveCardInput => ({
    ...oneFailing,
    slices: [slice],
    checks,
    gate: { gate: td1, alsoRun: [] },
  });

  test("the short screen says what the gate did not run, as proof's answer tells", () => {
    const detail =
      "Every check passed (typecheck, lint), and so did the run of the 5 test files chosen from testsFrom: 9 tests. " +
      "bay check on the head found no error.";
    const chosen: WaveChecks = {
      ...passedChecks,
      proof: provedOf({ verdicts: [{ item: "checks", kind: "checks", verdict: "passed", detail }, scope("passed")] }),
    };
    const short = waveDrawn(input(chosen, settled("TD1", ownPassed("TD1"))))
      .card.lines.filter((line) => line.section === "checks" && line.short === true)
      .map((line) => line.words);
    assert.deepEqual(short.slice(0, 2), [
      "The fast checks and bay check passed; 9 tests passed.",
      "Not run: tests outside the td1 mode.",
    ]);
    const wholeGate: Gate = { gate: "whole", because: { why: "no slice" } };
    const whole = waveDrawn({
      ...input(chosen, settled("TD1", ownPassed("TD1"))),
      gate: { gate: wholeGate, alsoRun: [] },
    });
    assert.ok(whole.card.lines.some((line) => line.short === true && line.words === "Ran: every test of the project."));
  });

  test("a combined head on which bay check finds errors, such as a missing example file, withholds merge and says so", () => {
    const bayCheckFailed: WaveChecks = {
      ...passedChecks,
      proof: provedOf({
        verdicts: [
          { item: "checks", kind: "checks", verdict: "failed", detail: "bay check on the head found 4 errors." },
          scope("passed"),
        ],
        judgement: [],
        size: [],
      }),
    };
    const drawn = waveDrawn(input(bayCheckFailed, settled("TD1", ownPassed("TD1"))));
    const said = drawn.card.lines.map((line) => factOf({ ...line }));
    assert.equal(drawn.merge, false);
    assert.equal(drawn.card.withheld.merge, "The wave's checks failed on the slices combined.");
    assert.ok(
      said.some(
        (fact) =>
          fact.section === "problems" &&
          fact.words ===
            "The checks on the slices combined: the must item checks failed, as bay check on the head found 4 errors.",
      ),
    );
    assert.ok(said.some((fact) => fact.section === "checks" && fact.short && fact.words === "The checks failed."));
  });

  test("with every scope passed, merge is offered", () => {
    assert.equal(waveDrawn(input(checksWith([scope("passed")]), settled("TD1", ownPassed("TD1")))).merge, true);
  });

  test("the combined head's scope failed, not known or missing, or a slice in it with no scope verdict, withholds merge", () => {
    const cases = [
      input(checksWith([scope("failed")]), settled("TD1", ownPassed("TD1"))),
      input(checksWith([scope("inconclusive")]), settled("TD1", ownPassed("TD1"))),
      input(checksWith([]), settled("TD1", ownPassed("TD1"))),
      input(checksWith([scope("passed")]), settled("TD1", ownWithoutScope)),
    ];
    for (const each of cases) {
      const drawn = waveDrawn(each);
      assert.equal(drawn.merge, false);
      assert.match(drawn.card.withheld.merge ?? "", /mode gate stands only on scope passed/);
    }
  });
});
