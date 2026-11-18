import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import type { Action } from "../bay/generated/mode.ts";
import { hashOf } from "../bay/json.ts";
import type { Run } from "../bay/runs/runs.ts";
import {
  eventKinds,
  fixtureRefusal,
  fixtureSystem,
  messagesOf,
  notesFlow,
  openedRuns,
  problemsOf,
  runOf,
  waitingOf,
  withFlow,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

const pass: Action = {
  description: "When a test passes its input on.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read"],
  run: [{ script: "scripts/log.ts" }],
};

type Rules = { readonly merge: string; readonly sendBack: string };

const rules: Rules = { merge: "$steps.offer.output.given.merge", sendBack: "$steps.offer.output.given.sendBack" };

function mergeSteps(chosen: Rules = rules): Workflow["steps"] {
  return [
    { id: "offer", action: "pass", input: { given: "$trigger" } },
    {
      id: "card",
      approval: "Merge this slice?",
      show: "$steps.offer.output.given.shown",
      choices: {
        merge: { when: chosen.merge },
        "send-back": { when: chosen.sendBack },
        keep: {},
        discard: {},
      },
    },
    { id: "after", action: "pass", input: { taken: "$steps.card.output.choice" } },
  ];
}

function changesOf(steps: Workflow["steps"]): ReturnType<typeof withFlow> & { readonly notesActions: object } {
  return { ...withFlow(steps), notesActions: { pass } };
}

const everyChoiceOffered = [
  { name: "merge", status: "offered" },
  { name: "send-back", status: "offered" },
  { name: "keep", status: "offered" },
  { name: "discard", status: "offered" },
];

const allPassed = { summary: "11 of 11 items passed" };

const inconclusive = {
  summary: "1 must item is inconclusive",
  withheld: { merge: "1 must item is inconclusive." },
};

function endReason(run: Run): string {
  const state = run.state;
  assert.ok(state.status === "failed" || state.status === "undone", JSON.stringify(state));
  return state.reason;
}

describe("an approval with choices", () => {
  test("offers every choice whose rule is true, and a later step reads the choice taken", async () => {
    for (const choice of ["merge", "send-back", "keep", "discard"]) {
      const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
      const started = await runs.start(flow, { merge: true, sendBack: true, shown: allPassed });
      const id = runOf(started).id;
      assert.deepEqual(waitingOf(started), {
        reason: "approval",
        stepKey: "card",
        question: "Merge this slice?",
        hash: hashOf(allPassed),
        content: allPassed,
        choices: everyChoiceOffered,
      });
      const decision = { stepKey: "card", hash: hashOf(allPassed), choice, by: "owner at the terminal" };
      const run = runOf(await runs.approve(id, decision));
      assert.deepEqual(run.state, { status: "done", output: { taken: choice } });
      const card = run.steps.find((step) => step.key === "card");
      assert.ok(card?.status === "done");
      assert.deepEqual(card.output, { choice, content: allPassed });
      const recorded = run.events.find((event) => event.kind === "approval.recorded");
      assert.deepEqual(recorded?.detail, {
        stepKey: "card",
        hash: hashOf(allPassed),
        decision: "choice",
        choice,
        by: "owner at the terminal",
      });
      assert.equal(recorded.at, "2026-11-14T09:00:00.000Z");
      close();
    }
  });

  test("withholds a choice whose rule is false, shows its reason, and refuses it with that reason", async () => {
    const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const started = await runs.start(flow, { merge: false, sendBack: true, shown: inconclusive });
    const id = runOf(started).id;
    const waiting = waitingOf(started);
    assert.deepEqual(waiting, {
      reason: "approval",
      stepKey: "card",
      question: "Merge this slice?",
      hash: hashOf(inconclusive),
      content: inconclusive,
      choices: [
        { name: "merge", status: "withheld", reason: "1 must item is inconclusive." },
        { name: "send-back", status: "offered" },
        { name: "keep", status: "offered" },
        { name: "discard", status: "offered" },
      ],
    });
    const decision = { stepKey: "card", hash: hashOf(inconclusive), by: "owner at the terminal" };
    assert.deepEqual(problemsOf(await runs.approve(id, { ...decision, choice: "merge" })), [
      "The choice merge of step card is withheld: 1 must item is inconclusive.",
    ]);
    assert.deepEqual(problemsOf(await runs.approve(id, { ...decision, choice: "ship" })), [
      "Step card has no choice ship; the choices offered are send-back, keep and discard.",
    ]);
    const after = runOf(await runs.show(id));
    assert.deepEqual(waitingOf(await runs.show(id)), waiting);
    assert.ok(!eventKinds(after).includes("approval.recorded"));
    const run = runOf(await runs.approve(id, { ...decision, choice: "send-back" }));
    assert.deepEqual(run.state, { status: "done", output: { taken: "send-back" } });
    close();
  });

  test("the hash binds the withheld reasons, and a decision on another hash is refused", async () => {
    const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const other = { ...inconclusive, withheld: { merge: "2 must items failed." } };
    const first = waitingOf(await runs.start(flow, { merge: false, sendBack: true, shown: inconclusive }));
    const second = await runs.start(flow, { merge: false, sendBack: true, shown: other });
    const secondWaiting = waitingOf(second);
    assert.equal(first.reason === "approval" ? first.hash : "", hashOf(inconclusive));
    assert.equal(secondWaiting.reason === "approval" ? secondWaiting.hash : "", hashOf(other));
    assert.notEqual(hashOf(inconclusive), hashOf(other));
    const stale = { stepKey: "card", hash: hashOf(inconclusive), choice: "keep", by: "owner at the terminal" };
    assert.deepEqual(problemsOf(await runs.approve(runOf(second).id, stale)), [
      `The hash ${hashOf(inconclusive)} is not the hash of what step card showed (${hashOf(other)}).`,
    ]);
    close();
  });

  test("a withheld choice with no reason in what the step shows fails the step", async () => {
    const { runs, runner, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const run = runOf(await runs.start(flow, { merge: false, sendBack: false, shown: inconclusive }));
    assert.equal(
      endReason(run),
      "Step card withholds the choice send-back, since its rule is false, " +
        "but what it shows gives no reason under withheld.send-back.",
    );
    assert.equal(runner.runsOf("notes:scripts/log.ts").length, 1);
    close();
  });

  test("a reason for a choice that is offered fails the step", async () => {
    const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const run = runOf(await runs.start(flow, { merge: true, sendBack: true, shown: inconclusive }));
    assert.equal(
      endReason(run),
      "Step card shows a reason under withheld.merge, but its choice merge is offered; " +
        "what a step shows gives a reason only for a choice it withholds.",
    );
    close();
  });

  test("a rule that is not true or false fails the step with a sentence and is never taken as true", async () => {
    const cases: readonly (readonly [Json, string])[] = [
      [
        "yes",
        'Step card cannot offer the choice merge: its rule $steps.offer.output.given.merge is "yes", not true or false.',
      ],
      [1, "Step card cannot offer the choice merge: its rule $steps.offer.output.given.merge is 1, not true or false."],
    ];
    for (const [merge, reason] of cases) {
      const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
      const run = runOf(await runs.start(flow, { merge, sendBack: true, shown: allPassed }));
      assert.equal(endReason(run), reason);
      assert.ok(!eventKinds(run).includes("run.waiting"));
      close();
    }
  });

  test("a rule that resolves to nothing fails the step with the sentence of the reference", async () => {
    const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const run = runOf(await runs.start(flow, { sendBack: true, shown: allPassed }));
    assert.equal(
      endReason(run),
      "Step card cannot offer the choice merge: $steps.offer.output.given.merge resolves to nothing: " +
        "output.given of step offer has no merge; it is a mapping with the keys sendBack, shown.",
    );
    close();
  });

  test("a rule that names a step that does not run before the approval is refused when the workflow loads", async () => {
    const steps = mergeSteps({ merge: "$steps.after.output", sendBack: rules.sendBack });
    assert.deepEqual(await fixtureRefusal(changesOf(steps)), [
      "Workflow workflows/flow.yaml of mode notes has a reference problem: $steps.after.output names the step " +
        "after, which is not defined before this step in its scope (earlier steps: offer).",
    ]);
  });

  test("a rule that is not an earlier step's output is refused when the workflow loads", async () => {
    const steps = mergeSteps({ merge: "$settings.greeting", sendBack: "$trigger" });
    assert.deepEqual(await fixtureRefusal(changesOf(steps)), [
      "Workflow workflows/flow.yaml of mode notes has a reference problem: the rule of the choice merge is " +
        "$settings.greeting, but a rule reads an earlier step's output: $steps.<id>.output with an optional path.",
      "Workflow workflows/flow.yaml of mode notes has a reference problem: the rule of the choice send-back is " +
        "$trigger, but a rule reads an earlier step's output: $steps.<id>.output with an optional path.",
    ]);
  });

  test("a decision must name a choice where the step has choices, and only there", async () => {
    const plain = [{ id: "keep", approval: "Keep it?", show: "$trigger" }];
    const { runs, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const started = await runs.start(flow, { merge: true, sendBack: true, shown: allPassed });
    const verdict = { stepKey: "card", hash: hashOf(allPassed), verdict: "approve", by: "me" } as const;
    assert.deepEqual(problemsOf(await runs.approve(runOf(started).id, verdict)), [
      "Step card offers choices, so a decision names one of them: merge, send-back, keep or discard.",
    ]);
    close();
    const second = await openedRuns({ changes: changesOf(plain) });
    const waiting = await second.runs.start(flow, "hello");
    const chosen = { stepKey: "keep", hash: hashOf("hello"), choice: "merge", by: "me" };
    assert.deepEqual(problemsOf(await second.runs.approve(runOf(waiting).id, chosen)), [
      "Step keep offers no choices, so a decision approves or rejects what it shows.",
    ]);
    second.close();
  });

  test("a run stopped at an approval with choices offers the same choices after the process ends", async () => {
    const { runs, reopen, close } = await openedRuns({ changes: changesOf(mergeSteps()) });
    const started = await runs.start(flow, { merge: false, sendBack: true, shown: inconclusive });
    const id = runOf(started).id;
    const first = waitingOf(started);
    runs.close();
    const swapped = mergeSteps({ merge: rules.sendBack, sendBack: rules.merge });
    const edited = await fixtureSystem(changesOf(swapped));
    const later = await reopen(edited.system);
    assert.deepEqual(waitingOf(await later.resume(id)), first);
    assert.deepEqual(waitingOf(await later.show(id)), first);
    const decision = { stepKey: "card", hash: hashOf(inconclusive), choice: "merge", by: "owner at the terminal" };
    assert.match(messagesOf(await later.approve(id, decision)), /^The choice merge of step card is withheld: 1 must/);
    const run = runOf(await later.approve(id, { ...decision, choice: "send-back" }));
    assert.deepEqual(run.state, { status: "done", output: { taken: "send-back" } });
    close();
  });
});
