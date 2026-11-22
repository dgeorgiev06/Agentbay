import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { split, trialsIn } from "../scripts/lib/tried-block.ts";
import { plannedTrials, ranOf, resultOf, roomBeside, trialItems, type Trial } from "../scripts/lib/tried-examples.ts";
import { addToTry, countToTry, emptyName, inRounds, twentyA } from "./tally-design.ts";

const notKnownReasons = {
  unreadable: "what the last call printed is not the run bay call --json prints",
  notStarted: "the kernel did not start the call, for a reason other than the request schema",
  notMade: "proof could not make the calls in a copy or read what the last one printed whole",
};

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

function printed(stdout: string): { readonly printed: { readonly exitCode: number; readonly stdout: string } } {
  return { printed: { exitCode: 0, stdout } };
}

function addTrials(): readonly Trial[] {
  return trialsIn(plannedTrials("TL1", [addToTry], inRounds));
}

function trialAt(index: number): Trial {
  return addTrials()[index] ?? assert.fail(`no trial ${String(index)}`);
}

const ann = { name: "ann" };

describe("which of the design's examples are tried, and how each is called", () => {
  test("each example is its own trial: its earlier calls in order, then its input, each by bay call on the mode, which is not the interface's name, its long text spelled out", () => {
    assert.deepEqual(
      addTrials().map((trial) => [trial.action, trial.number, trial.runs]),
      [
        ["counting.add", 1, [call("tally.add", ann)]],
        ["counting.add", 2, [call("tally.add", ann), call("tally.add", ann)]],
        ["counting.add", 3, [call("tally.add", { name: "" })]],
        ["counting.add", 4, [call("tally.add", { name: twentyA })]],
      ],
    );
    assert.deepEqual(trialAt(3).expected, { kind: "answer", value: { name: twentyA, count: 1 } });
    assert.deepEqual(trialAt(2).expected, { kind: "refusal", sentence: emptyName });
  });

  test("the earlier calls come first, in the design's order, and the example's own input last", () => {
    const earlier = [
      { action: "add", input: { name: "bo" } },
      { action: "count", input: { name: "cy" } },
    ];
    const toTry = { ...addToTry, examples: [{ earlier, input: ann, answer: { name: "ann", count: 1 } }] };
    const [trial] = trialsIn(plannedTrials("TL1", [toTry], { ...inRounds, built: ["counting.add", "counting.count"] }));
    assert.deepEqual(trial?.runs, [
      call("tally.add", { name: "bo" }),
      call("tally.count", { name: "cy" }),
      call("tally.add", ann),
    ]);
  });

  test("an example whose earlier call names an action the head does not build is not tried yet, with the reason", () => {
    const entries = plannedTrials("TL2", [countToTry], { ...inRounds, built: ["counting.count"] });
    assert.deepEqual(entries, [
      {
        slice: "TL2",
        action: "counting.count",
        number: 1,
        outcome: "not tried",
        reason: "it calls counting.add first, which this slice does not build",
      },
    ]);
  });

  test("proof takes 100 items: the room beside a slice's own items, and an example past the room is not tried", () => {
    assert.equal(roomBeside(3), 97);
    const full = plannedTrials("TL1", [addToTry], { ...inRounds, room: 2 });
    assert.deepEqual(
      full.map((entry) => (entry.outcome === "not tried" ? entry.reason : entry.outcome)),
      ["to try", "to try", "proof takes at most 100 items in one call", "proof takes at most 100 items in one call"],
    );
  });

  test("a request of 50,000 characters as one word is tried, and one of 50,001 is not", () => {
    const sized = (length: number): Json => ({ name: "x".repeat(length - JSON.stringify({ name: "" }).length) });
    const of = (length: number): Json => ({ input: sized(length), answer: { name: "x", count: 1 } });
    const entries = plannedTrials("TL1", [{ ...addToTry, examples: [of(50_000), of(50_001)] }], inRounds);
    assert.deepEqual(
      entries.map((entry) => (entry.outcome === "not tried" ? entry.reason : entry.outcome)),
      ["to try", "a request in it is longer than proof takes in one word"],
    );
  });

  test("with no one module named for the interface, or a long text that cannot be spelled, an example is not tried", () => {
    const noMode = plannedTrials("TL1", [{ action: "counting.add", examples: [{ input: ann, answer: {} }] }], inRounds);
    assert.deepEqual(
      noMode.map((entry) => (entry.outcome === "not tried" ? entry.reason : entry.outcome)),
      ["no one module of the design offers the interface counting, so forge cannot tell which mode to call"],
    );
    const unspelled = { input: { name: { $text: [] } }, answer: { name: "", count: 1 } };
    const bad = plannedTrials("TL1", [{ ...addToTry, examples: [unspelled] }], inRounds);
    assert.deepEqual(
      bad.map((entry) => (entry.outcome === "not tried" ? entry.reason : entry.outcome)),
      ["a long text in it cannot be spelled out"],
    );
  });

  test("each trial is one item of the kind printed, so proof makes each in a fresh copy of its own", () => {
    const items = trialItems(addTrials());
    assert.deepEqual(
      items.map((item) => item.id),
      ["tried-1", "tried-2", "tried-3", "tried-4"],
    );
    assert.deepEqual(items[1]?.proof, {
      kind: "printed",
      runs: [{ bay: call("tally.add", ann) }, { bay: call("tally.add", ann) }],
    });
  });
});

describe("what a call of the built mode answered, compared with the design", () => {
  test("an answer equal to the design's as JSON, whatever the order of its keys, is as designed", () => {
    assert.equal(resultOf(trialAt(0), printed(done({ count: 1, name: "ann" }))).outcome, "as designed");
  });

  test("an answer that differs in one value is answered otherwise, with both sides as JSON", () => {
    assert.deepEqual(resultOf(trialAt(0), printed(done({ name: "ann", count: 2 }))), {
      slice: "TL1",
      action: "counting.add",
      number: 1,
      outcome: "otherwise",
      designed: { how: "answers", text: '{"name":"ann","count":1}' },
      built: { how: "answered", text: '{"name":"ann","count":2}' },
    });
  });

  test("the answer is compared whole: one key more, or a list one longer, is otherwise", () => {
    assert.equal(resultOf(trialAt(0), printed(done({ name: "ann", count: 1, extra: true }))).outcome, "otherwise");
    const listed = { ...addToTry, examples: [{ input: ann, answer: [1] }] };
    const [trial] = trialsIn(plannedTrials("TL1", [listed], inRounds));
    assert.equal(resultOf(trial ?? assert.fail("no trial"), printed(done([1, 2]))).outcome, "otherwise");
    assert.equal(resultOf(trial ?? assert.fail("no trial"), printed(done([1]))).outcome, "as designed");
  });

  test("a refusal is compared by its exact sentence: one that says more, or ends with a space, is otherwise", () => {
    assert.equal(resultOf(trialAt(2), printed(refused(emptyName))).outcome, "as designed");
    assert.equal(resultOf(trialAt(2), printed(refused(`${emptyName} `))).outcome, "otherwise");
    assert.deepEqual(resultOf(trialAt(2), printed(refused(`${emptyName} Try again.`))), {
      slice: "TL1",
      action: "counting.add",
      number: 3,
      outcome: "otherwise",
      designed: { how: "refuses", text: emptyName },
      built: { how: "refused", text: `${emptyName} Try again.` },
    });
  });

  test("a refusal by the request schema before the mode ran is counted apart for a refusal, and is otherwise for an answer", () => {
    const schema = problem("/input/name", "input.name is not valid (must NOT have fewer than 1 characters).");
    assert.equal(resultOf(trialAt(2), printed(schema)).outcome, "refused by its schema");
    const forAnswer = resultOf(trialAt(0), printed(schema));
    assert.equal(forAnswer.outcome, "otherwise");
    assert.equal(forAnswer.built.how, "refused by the request schema");
  });

  test("a call the kernel did not start, a call that waits and output that is no run are not known, and the reason quotes nothing the kernel printed", () => {
    const notStarted = resultOf(
      trialAt(0),
      printed(problem("/runs/new", "Mode tally has no action add; builder-key.")),
    );
    assert.deepEqual(notStarted.outcome === "not known" ? notStarted.reason : "", notKnownReasons.notStarted);
    const waiting = JSON.stringify({ ok: true, run: { id: "r3", status: "waiting", waitingFor: "skill" } });
    const waited = resultOf(trialAt(0), printed(waiting));
    assert.deepEqual(
      waited.outcome === "not known" ? waited.reason : "",
      "the call waits for a skill's answer, which nobody gives in a throwaway copy",
    );
    const garbled = resultOf(trialAt(0), printed("Hello.\n"));
    assert.deepEqual(garbled.outcome === "not known" ? garbled.reason : "", notKnownReasons.unreadable);
  });

  test("a run in a status the rule does not know is never read as an answer", () => {
    const running = JSON.stringify({
      ok: true,
      run: { id: "r4", status: "running", output: { name: "ann", count: 1 } },
    });
    assert.equal(resultOf(trialAt(0), printed(running)).outcome, "not known");
    assert.deepEqual(ranOf(running), { kind: "unreadable" });
  });

  test("a trial proof could not make is not known with a sentence of forge's own, and is never as designed", () => {
    assert.deepEqual(resultOf(trialAt(0), { notKnown: true }), {
      slice: "TL1",
      action: "counting.add",
      number: 1,
      outcome: "not known",
      reason: notKnownReasons.notMade,
    });
  });

  test("proof's inconclusive verdict, or a passed one with nothing printed, is read as not made, never as a run", () => {
    const answer = {
      verdicts: [
        { item: "tried-1", kind: "printed", verdict: "inconclusive", reason: "Run 1 of 1 is not known." },
        { item: "tried-2", kind: "printed", verdict: "passed", detail: "Ran." },
        { item: "tried-3", kind: "printed", verdict: "passed", detail: "Ran.", printed: { exitCode: 0, stdout: "x" } },
        { item: "scope", kind: "in-scope", verdict: "passed", detail: "It held." },
      ],
    };
    const apart = split(answer);
    assert.deepEqual(
      [...apart.proved.values()],
      [{ notKnown: true }, { notKnown: true }, { printed: { exitCode: 0, stdout: "x" } }],
    );
    assert.deepEqual(apart.proof, { verdicts: [answer.verdicts[3]] });
  });

  test("bay call's own output is read: a run done, a run failed and a problem of the kernel", () => {
    assert.deepEqual(ranOf(done({ count: 1 })), { kind: "answered", output: { count: 1 } });
    assert.deepEqual(ranOf(refused("No.")), { kind: "refused", reason: "No." });
    assert.deepEqual(ranOf(problem("/input", "input is not valid.")), {
      kind: "schema refused",
      message: "input is not valid.",
    });
    assert.deepEqual(ranOf(problem("/runs/new", "Mode x is not active.")), { kind: "not started" });
  });
});
