import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf } from "../../../../bay/sdk.ts";
import { planOf } from "../scripts/lib/plan-form.ts";
import { provedOf } from "../scripts/lib/proof-answer.ts";
import { sliceOf, type Slice } from "../scripts/lib/slice-form.ts";
import { aloneWords, waveAnswer, type Alone, type Joined, type WaveChecks } from "../scripts/lib/wave-answer.ts";
import { waveDrawn, type WaveCardInput } from "../scripts/lib/wave-card.ts";
import { ownProofReason, type Settled } from "../scripts/lib/wave-standing.ts";
import { waveStartCard } from "../scripts/lib/wave-start-card.ts";
import { printed, widest } from "./printed-card.ts";
import type { Proved } from "./kit-copy.ts";
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
  practices: {
    tally: { held: 64, notHeld: 1, doesNotApply: 0 },
    notHeld: [{ id: "P-12", says: "Functions stay small.", path: "src/count.ts", sentence: "count is 40 lines." }],
    checks: 12,
  },
};

const waveSkills = {
  "review-1": "forge skills/review, tier deep",
  "round-1": "forge skills/write-tests, tier balanced; forge skills/build-without-tests, tier balanced",
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

describe("the wave's start card", () => {
  test("two slices of wave 1, built side by side, read line by line as pinned", () => {
    const plan = planOf({ title: "A wave", slices: [plannedSlice("TD1"), plannedSlice("TD10")] });
    const card = waveStartCard({
      plan: "docs/plans/0099-wave.yaml",
      wave: 1,
      waves: 2,
      base: "875d936",
      into: "integration",
      slices: plan.slices,
      sideBySide: 2,
      leftovers: [],
    });
    assert.equal(
      printed(card, [
        { name: "build", does: "Build the wave's slices side by side" },
        { name: "stop", does: "Stop; nothing is cut" },
      ]),
      [
        "Build wave 1 of 0099-wave.yaml?",
        "  2 slices of wave 1 of 2 in",
        "    docs/plans/0099-wave.yaml",
        "  base 875d936, the head of integration",
        "  TD1: The td1 mode counts what was added",
        "  TD1, scope components/modes/td1/**; meets",
        "    no condition; 1 interface file",
        "  TD10: The td10 mode counts what was added",
        "  TD10, scope components/modes/td10/**;",
        "    meets no condition; 1 interface file",
        "  side by side: at most 2 builders, the",
        "    setting sideBySide",
        "  cost: at most 27 model calls a slice, 54",
        "    for the wave",
        "  each slice's own proof leaves out the",
        "    checks; they and the whole test run go",
        "    once, on the slices combined",
        "All lines worked out by script.",
        "You can:",
        "  build  Build the wave's slices side by",
        "         side",
        "  stop   Stop; nothing is cut",
        "checked: 0 ran, 9 computed, 0 judged",
      ].join("\n"),
    );
  });

  test("a wave with more slices than the setting says which start first and that the rest start as slices end", () => {
    const plan = planOf({ title: "A wave", slices: ["A1", "A2", "A3", "A4"].map(plannedSlice) });
    const start = {
      plan: "p.yaml",
      wave: 1,
      waves: 1,
      base: "875d936",
      into: "integration",
      sideBySide: 2,
      leftovers: [],
    };
    const words = waveStartCard({ ...start, slices: plan.slices }).lines.map((line) => line.words);
    assert.ok(
      words.includes("first A1 and A2; then A3 and A4, each starting as soon as a slice ends"),
      words.join("\n"),
    );
    const three = waveStartCard({ ...start, slices: plan.slices.slice(0, 3) }).lines.map((line) => line.words);
    assert.ok(three.includes("first A1 and A2; then A3, which starts as soon as a slice ends"), three.join("\n"));
    assert.ok(waveStartCard({ ...start, slices: plan.slices }).lines.every((line) => line.source.step === "wave"));
  });
});

describe("the wave's merge card", () => {
  test("two slices, one failing its own proof, read line by line as pinned", () => {
    const drawn = waveDrawn(oneFailing);
    assert.equal(drawn.merge, true);
    const text = printed(
      drawn.card,
      [
        { name: "merge", does: "Merge the combined head into the integration branch" },
        { name: "keep", does: "Stop; every slice's branches stay" },
      ],
      {
        skills: waveSkills,
        items: ["TD1 (The td1 mode counts what was added)", "TD2 (The td2 mode counts what was added)"],
      },
    );
    assert.equal(
      text,
      [
        "Merge wave 1 into integration?",
        "  Merge is offered for 1 of 2 slices: each",
        "    passed its own proof, and the wave's",
        "    checks passed on them combined; left",
        "    out: TD2 (The td2 mode counts what was",
        "    added), as its own proof did not pass.",
        "  TD1: The td1 mode counts what was added",
        "  TD1 is in the combined head; the work and",
        "    the tests are on forge/TD1-tests-1, the",
        "    builder's work alone on forge/TD1",
        "  DOD-TD1-1, must, passed: What was added is",
        "    counted.",
        "  scope, must, passed: Every changed path is",
        "    in the write scope.",
        "  declared, must, passed: What changed is as",
        "    declared.",
        "  practices answered by the reviewer in",
        "    round 1: 65; 64 held, 1 not held, 0 do",
        "    not apply; a check holds 12 more",
        "judged   P-12, not held: Functions stay",
        "judged     small. In src/count.ts: count is",
        "judged     40 lines.",
        "judged    by forge skills/review, tier deep,",
        "judged      for TD1 (The td1 mode counts",
        "judged      what was added)",
        "  interface files: 1 unchanged since the",
        "    base, by hash",
        "  rounds: 1 of at most 3; the reviewer had",
        "    no findings",
        "  the reviewer, in round 1, before the final",
        "    proof:",
        "judged   DOD-TD1-1 held by 2 cases",
        "judged   no finding remains",
        "judged    by forge skills/review, tier deep,",
        "judged      for TD1 (The td1 mode counts",
        "judged      what was added)",
        "judged   the builder decided: TD1 counts in",
        "judged     memory",
        "judged    by forge skills/write-tests, tier",
        "judged      balanced; forge",
        "judged      skills/build-without-tests, tier",
        "judged      balanced, for TD1 (The td1 mode",
        "judged      counts what was added)",
        "  TD2: The td2 mode counts what was added",
        "  TD2 is left out: 1 must item failed. Its",
        "    branches stay; the work and the tests",
        "    are on forge/TD2-tests-1, the builder's",
        "    work alone on forge/TD2",
        "  DOD-TD2-1, must, failed: What was added is",
        "    counted.",
        "  why: the named tests fail on the head",
        "  proof's reason: The named tests fail on",
        "    the head.",
        "  scope, must, passed: Every changed path is",
        "    in the write scope.",
        "  declared, must, passed: What changed is as",
        "    declared.",
        "  practices answered by the reviewer in",
        "    round 1: 65; 64 held, 1 not held, 0 do",
        "    not apply; a check holds 12 more",
        "judged   P-12, not held: Functions stay",
        "judged     small. In src/count.ts: count is",
        "judged     40 lines.",
        "judged    by forge skills/review, tier deep,",
        "judged      for TD2 (The td2 mode counts",
        "judged      what was added)",
        "  interface files: 1 unchanged since the",
        "    base, by hash",
        "  rounds: 1 of at most 3; the reviewer had",
        "    no findings",
        "  the reviewer, in round 1, before the final",
        "    proof:",
        "judged   DOD-TD1-1 held by 2 cases",
        "judged   no finding remains",
        "judged    by forge skills/review, tier deep,",
        "judged      for TD2 (The td2 mode counts",
        "judged      what was added)",
        "judged   the builder decided: TD2 counts in",
        "judged     memory",
        "judged    by forge skills/write-tests, tier",
        "judged      balanced; forge",
        "judged      skills/build-without-tests, tier",
        "judged      balanced, for TD2 (The td2 mode",
        "judged      counts what was added)",
        "  the combined head: 3710c98 on",
        "    forge/wave-1, with TD1 merged in plan",
        "    order",
        "  checks, must, passed: The checks and the",
        "    whole test run pass.",
        "  checks passed: typecheck, lint",
        "  tests passed: 40",
        "Unmarked lines were worked out by script.",
        "You can:",
        "  merge  Merge the combined head into the",
        "         integration branch",
        "  keep   Stop; every slice's branches stay",
        "checked: 0 ran, 25 computed, 8 judged",
      ].join("\n"),
    );
    assert.ok(text.split("\n").every((row) => Array.from(row).length <= widest));
  });

  test("every failing slice is named with its reason, never only the first", () => {
    const three = [
      settled("TD1", ownFailed("TD1"), "1 must item failed."),
      settled("TD2", ownPassed("TD2"), "the builder stopped."),
      settled("TD3", ownPassed("TD3")),
    ];
    const answer = waveAnswer(three, { ...combined, merged: ["TD3"] }, passedChecks);
    assert.equal(
      answer.words,
      "Merge is offered for 1 of 3 slices: each passed its own proof, and the wave's checks passed on them " +
        "combined; left out: TD1 (The td1 mode counts what was added) and TD2 (The td2 mode counts what was " +
        "added), as their own proofs did not pass.",
    );
    const words = waveDrawn({ ...oneFailing, slices: three }).card.lines.map((line) => line.words);
    assert.ok(
      words.includes(
        "TD1 is left out: 1 must item failed. Its branches stay; the work and the tests are on forge/TD1-tests-1, " +
          "the builder's work alone on forge/TD1",
      ),
    );
    assert.ok(
      words.includes(
        "TD2 is left out: the builder stopped. Its branches stay; the work and the tests are on forge/TD2-tests-1, " +
          "the builder's work alone on forge/TD2",
      ),
    );
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
    assert.deepEqual(waveAnswer(two, combined, failing), {
      offered: false,
      words: "Merge is not offered: the wave's checks failed on the slices combined.",
      reason: "the wave's checks failed on the slices combined.",
    });
    const unknown: WaveChecks = { ...passedChecks, proof: { verdicts: [], size: [] } };
    assert.equal(waveAnswer(two, combined, unknown).offered, false);
    assert.equal(waveAnswer(two, combined, { kind: "not asked" }).offered, false);
  });

  test("a merge that does not apply names both slices, and no slice passing names that", () => {
    const conflict: Joined = { kind: "conflict", slice: "TD2", onto: ["TD1"], reason: "It conflicts in a.ts." };
    assert.equal(
      waveAnswer(two, conflict, { kind: "not asked" }).words,
      "Merge is not offered: TD2 (The td2 mode counts what was added) does not merge cleanly onto TD1 in the " +
        "combined head.",
    );
    const none = [settled("TD1", ownFailed("TD1"), "1 must item failed.")];
    assert.equal(
      waveAnswer(none, { kind: "nothing to join" }, { kind: "not asked" }).words,
      "Merge is not offered: no slice passed its own proof; left out: TD1 (The td1 mode counts what was added), " +
        "as its own proof did not pass.",
    );
  });
  test("a long title is shortened in the answer, both where a slice is left out and where it conflicts", () => {
    const long = "The td3 mode counts what was added, removed and moved across every folder";
    const third = { ...settled("TD3", ownFailed("TD3"), "1 must item failed."), title: long };
    const conflict: Joined = { kind: "conflict", slice: "TD3", onto: ["TD1"], reason: "It conflicts in a.ts." };
    assert.equal(
      waveAnswer([...two, third], conflict, { kind: "not asked" }).words,
      "Merge is not offered: TD3 (The td3 mode counts what was added, remo...) does not merge cleanly onto TD1 " +
        "in the combined head; left out: TD3 (The td3 mode counts what was added, remo...), as its own proof did " +
        "not pass.",
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
