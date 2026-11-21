import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { plannedTrials, ranOf, resultOf, trialItems, type Entry, type Trial } from "../scripts/lib/tried-examples.ts";

const empty = "The name is empty; give a name of 1 to 20 characters.";

const added = (name: Json): Json => ({ action: "add", input: { name } });

const addExamples: readonly Json[] = [
  { input: { name: "ann" }, answer: { name: "ann", count: 1 } },
  { earlier: [added("ann")], input: { name: "ann" }, answer: { name: "ann", count: 2 } },
  { input: { name: "" }, refusal: empty },
  { input: { name: { $text: [{ repeat: "a", times: 20 }] } }, answer: { name: "a".repeat(20), count: 1 } },
];

const countExamples: readonly Json[] = [{ earlier: [added("bo")], input: { name: "bo" }, answer: { count: 1 } }];

const inRounds = { built: ["tally.add"], room: 100, notBuilt: "which this slice does not build" };

function trialsOf(entries: readonly Entry[]): readonly Trial[] {
  return entries.flatMap((entry) => (entry.outcome === "to try" ? [entry] : []));
}

function call(action: string, input: Json): readonly string[] {
  return ["call", action, JSON.stringify(input), "--json"];
}

function done(output: Json): string {
  return `${JSON.stringify({ ok: true, run: { id: "r1", status: "done", output, spent: {} } })}\n`;
}

function refused(reason: string): string {
  return `${JSON.stringify({ ok: false, run: { id: "r2", status: "failed", reason } })}\n`;
}

function problem(path: string, message: string): string {
  return `${JSON.stringify({ ok: false, problems: [{ file: ".agentbay/kernel.db", path, message }] })}\n`;
}

describe("which of the design's examples are tried, and how each is called", () => {
  test("each example is its own trial: its earlier calls in order, then its input, each by bay call on the design's mode, its long text spelled out", () => {
    const entries = plannedTrials("TL1", [{ action: "tally.add", mode: "tally", examples: addExamples }], inRounds);
    const trials = trialsOf(entries);
    assert.deepEqual(
      trials.map((trial) => [trial.action, trial.number, trial.runs]),
      [
        ["tally.add", 1, [call("tally.add", { name: "ann" })]],
        ["tally.add", 2, [call("tally.add", { name: "ann" }), call("tally.add", { name: "ann" })]],
        ["tally.add", 3, [call("tally.add", { name: "" })]],
        ["tally.add", 4, [call("tally.add", { name: "a".repeat(20) })]],
      ],
    );
    assert.deepEqual(trials[3]?.expected, { kind: "answer", value: { name: "a".repeat(20), count: 1 } });
    assert.deepEqual(trials[2]?.expected, { kind: "refusal", sentence: empty });
  });

  test("an example whose earlier call names an action the head does not build is not tried yet, with the reason", () => {
    const entries = plannedTrials("TL2", [{ action: "tally.count", mode: "tally", examples: countExamples }], {
      ...inRounds,
      built: ["tally.count"],
    });
    assert.deepEqual(entries, [
      {
        slice: "TL2",
        action: "tally.count",
        number: 1,
        outcome: "not tried",
        reason: "it calls tally.add first, which this slice does not build",
      },
    ]);
  });

  test("with no one module named for the interface, past proof's room, or with a long text that cannot be spelled, an example is not tried", () => {
    const noMode = plannedTrials("TL1", [{ action: "tally.add", examples: addExamples.slice(0, 1) }], inRounds);
    assert.deepEqual(
      noMode.map((entry) => (entry.outcome === "not tried" ? entry.reason : entry.outcome)),
      ["no one module of the design offers the interface tally, so forge cannot tell which mode to call"],
    );
    const full = plannedTrials("TL1", [{ action: "tally.add", mode: "tally", examples: addExamples }], {
      ...inRounds,
      room: 2,
    });
    assert.deepEqual(
      full.map((entry) => entry.outcome),
      ["to try", "to try", "not tried", "not tried"],
    );
    const unspelled = { input: { name: { $text: [] } }, answer: { name: "", count: 1 } };
    const bad = plannedTrials("TL1", [{ action: "tally.add", mode: "tally", examples: [unspelled] }], inRounds);
    assert.deepEqual(
      bad.map((entry) => (entry.outcome === "not tried" ? entry.reason : entry.outcome)),
      ["a long text in it cannot be spelled out"],
    );
  });

  test("each trial is one item of the kind printed, so proof makes each in a fresh copy of its own", () => {
    const entries = plannedTrials("TL1", [{ action: "tally.add", mode: "tally", examples: addExamples }], inRounds);
    const items = trialItems(trialsOf(entries));
    assert.equal(items.length, 4);
    assert.deepEqual(
      items.map((item) => item.id),
      ["tried-1", "tried-2", "tried-3", "tried-4"],
    );
    assert.deepEqual(items[1]?.proof, {
      kind: "printed",
      runs: [{ bay: call("tally.add", { name: "ann" }) }, { bay: call("tally.add", { name: "ann" }) }],
    });
  });
});

describe("what a call of the built mode answered, compared with the design", () => {
  const [first, , refusal] = trialsOf(
    plannedTrials("TL1", [{ action: "tally.add", mode: "tally", examples: addExamples }], inRounds),
  );
  const answer = first ?? assert.fail("no trial");
  const refusing = refusal ?? assert.fail("no trial");

  test("an answer equal to the design's as JSON, whatever the order of its keys, is as designed", () => {
    const printed = { printed: [{ exitCode: 0, stdout: done({ count: 1, name: "ann" }) }] };
    assert.equal(resultOf(answer, printed).outcome, "as designed");
  });

  test("an answer that differs in one value is answered otherwise, with both sides as JSON", () => {
    const result = resultOf(answer, { printed: [{ exitCode: 0, stdout: done({ name: "ann", count: 2 }) }] });
    assert.deepEqual(result, {
      slice: "TL1",
      action: "tally.add",
      number: 1,
      outcome: "otherwise",
      designed: { how: "answers", text: '{"name":"ann","count":1}' },
      built: { how: "answered", text: '{"name":"ann","count":2}' },
    });
  });

  test("an answer that holds more than the design's is answered otherwise: the answer is compared whole", () => {
    const more = done({ name: "ann", count: 1, extra: true });
    assert.equal(resultOf(answer, { printed: [{ exitCode: 0, stdout: more }] }).outcome, "otherwise");
  });

  test("a refusal is compared by its exact sentence: equal is as designed, a sentence that says more is otherwise", () => {
    assert.equal(resultOf(refusing, { printed: [{ exitCode: 1, stdout: refused(empty) }] }).outcome, "as designed");
    const longer = resultOf(refusing, { printed: [{ exitCode: 1, stdout: refused(`${empty} Try again.`) }] });
    assert.deepEqual(longer, {
      slice: "TL1",
      action: "tally.add",
      number: 3,
      outcome: "otherwise",
      designed: { how: "refuses", text: empty },
      built: { how: "refused", text: `${empty} Try again.` },
    });
  });

  test("only the last call is compared; the earlier calls set up the state", () => {
    const second = trialsOf(
      plannedTrials("TL1", [{ action: "tally.add", mode: "tally", examples: addExamples }], inRounds),
    )[1];
    const runs = [
      { exitCode: 1, stdout: refused("anything") },
      { exitCode: 0, stdout: done({ name: "ann", count: 2 }) },
    ];
    assert.equal(resultOf(second ?? assert.fail("no trial"), { printed: runs }).outcome, "as designed");
  });

  test("a refusal by the request schema before the mode ran is counted apart for a refusal, and is otherwise for an answer", () => {
    const schema = problem("/input/name", "input.name is not valid (must NOT have fewer than 1 characters).");
    assert.equal(resultOf(refusing, { printed: [{ exitCode: 1, stdout: schema }] }).outcome, "refused by its schema");
    const forAnswer = resultOf(answer, { printed: [{ exitCode: 1, stdout: schema }] });
    assert.equal(forAnswer.outcome, "otherwise");
    assert.equal(forAnswer.built.how, "refused by the request schema");
  });

  test("a call the kernel did not start, or one that waits for a skill, is not tried; output that is no run is not known", () => {
    const notStarted = resultOf(answer, {
      printed: [{ exitCode: 1, stdout: problem("/runs/new", "Mode tally is not active.") }],
    });
    assert.deepEqual(
      notStarted.outcome === "not tried" ? notStarted.reason : notStarted.outcome,
      ['the kernel did not start the call: "Mode tally is not active."'].join(""),
    );
    const waiting = JSON.stringify({ ok: true, run: { id: "r3", status: "waiting", waitingFor: "skill" } });
    const waited = resultOf(answer, { printed: [{ exitCode: 0, stdout: waiting }] });
    assert.equal(waited.outcome, "not tried");
    const garbled = resultOf(answer, { printed: [{ exitCode: 0, stdout: "Hello.\n" }] });
    assert.deepEqual(
      garbled.outcome === "not known" ? garbled.reason : garbled.outcome,
      ["what the last call printed is not the run bay call --json prints"].join(""),
    );
  });

  test("a trial proof could not make is not known, with proof's reason, and is never as designed", () => {
    const result = resultOf(answer, { reason: "Run 1 of 1 is not known. It did not finish within 30 seconds." });
    assert.deepEqual(result, {
      slice: "TL1",
      action: "tally.add",
      number: 1,
      outcome: "not known",
      reason: "Run 1 of 1 is not known. It did not finish within 30 seconds.",
    });
  });

  test("bay call's own output is read: a run done, a run failed and a problem of the kernel", () => {
    assert.deepEqual(ranOf(done({ count: 1 })), { kind: "answered", output: { count: 1 } });
    assert.deepEqual(ranOf(refused("No.")), { kind: "refused", reason: "No." });
    assert.deepEqual(ranOf(problem("/input", "input is not valid.")), {
      kind: "schema refused",
      message: "input is not valid.",
    });
  });
});
