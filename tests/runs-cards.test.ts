import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EventSink, Json, ScriptRequest } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import type { Config } from "../bay/generated/config.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { hashOf } from "../bay/json.ts";
import type { Run, Runs } from "../bay/runs/runs.ts";
import {
  answer,
  finished,
  fixtureSystem,
  notesFlow,
  openedRuns,
  runOf,
  startTime,
  tokenOf,
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

const probe: Action = {
  description: "When a test runs a command.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read"],
  run: [{ script: "scripts/probe.ts" }],
};

const cardSteps: Workflow["steps"] = [
  { id: "check", action: "probe" },
  { id: "offer", action: "pass", input: { inScope: 11 } },
  { id: "review", action: "draft" },
  { id: "build", action: "draft" },
  { id: "draw", action: "pass", input: { card: "$steps.review.output.card" } },
  { id: "card", approval: "Merge this slice?", show: "$steps.draw.output.card", quotes: ["review", "offer"] },
];

const reviewWords = "the tests assert what each item says";

const builderWords = "Everything works and every test passes, trust me.";

type Card = {
  readonly title: string;
  readonly lines: readonly Json[];
};

type Opened = {
  readonly runs: Runs;
  readonly otherRun: string;
  readonly close: () => void;
};

async function openedCardRuns(): Promise<Opened> {
  let sink: () => EventSink = () => {
    throw new Error("no sink yet");
  };
  const ranLeave = async (request: ScriptRequest): Promise<ReturnType<typeof finished>> => {
    const detail = { step: request.place.stepKey, name: "leave", command: ["node", "--version"], folder: "." };
    await sink().append({ at: startTime.toISOString(), runId: request.place.runId, kind: "command", detail });
    return finished({ printed: "# pass 3" });
  };
  const opened = await openedRuns({
    changes: { ...withFlow(cardSteps), notesActions: { pass, probe } },
    scripts: { "notes:scripts/probe.ts": ranLeave },
  });
  sink = opened.sink;
  const other = runOf(await opened.runs.start({ action: "notes.probe" }, {}));
  return { runs: opened.runs, otherRun: other.id, close: opened.close };
}

type CardRun = {
  readonly run: Run;
  readonly called: string;
};

async function cardRun(opened: Opened, card: (called: string) => Card): Promise<CardRun> {
  const { runs } = opened;
  const atReview = runOf(await runs.start(flow, {}));
  const token = tokenOf(atReview);
  const called = await runs.callAction(token, "probe", {});
  assert.ok(called.ok, JSON.stringify(called));
  runOf(await runs.submit(token, answer({ text: reviewWords, card: card(called.value.runId) })));
  const atBuild = runOf(await runs.reissueTask(atReview.id));
  const run = runOf(await runs.submit(tokenOf(atBuild), answer({ text: builderWords })));
  return { run, called: called.value.runId };
}

function endReason(run: Run): string {
  const state = run.state;
  assert.ok(state.status === "failed" || state.status === "undone", JSON.stringify(state));
  return state.reason;
}

function oneLine(line: Json): () => Card {
  return () => ({ title: "Merge TR2?", lines: [line] });
}

async function refusedCard(line: Json): Promise<string> {
  const opened = await openedCardRuns();
  const { run } = await cardRun(opened, oneLine(line));
  assert.equal(run.steps.find((step) => step.key === "card")?.status, "failed");
  const waitedAt = run.events.filter((event) => event.kind === "run.waiting").map((event) => event.detail);
  assert.deepEqual(waitedAt, [
    { reason: "skill", stepKey: "review/0#1" },
    { reason: "skill", stepKey: "review/0#1" },
    { reason: "skill", stepKey: "build/0#1" },
  ]);
  opened.close();
  return endReason(run);
}

describe("a card on an approval", () => {
  test("a card whose every line is sound is shown with the skill of each judged line and the kernel's counts", async () => {
    const opened = await openedCardRuns();
    const card = (called: string): Card => ({
      title: "Merge TR2?",
      lines: [
        { mark: "ran", words: "# pass 3", source: { step: "check", command: "leave" } },
        { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "offer" } },
        { mark: "judged", words: reviewWords, source: { step: "review" } },
        { mark: "ran", words: "the review ran: # pass 3", source: { step: "review", command: "leave", run: called } },
      ],
    });
    const { run, called } = await cardRun(opened, card);
    const shown = card(called);
    assert.deepEqual(waitingOf({ ok: true, value: run }), {
      reason: "approval",
      stepKey: "card",
      question: "Merge this slice?",
      hash: hashOf(shown),
      content: shown,
      card: {
        title: "Merge TR2?",
        lines: [
          { mark: "ran", words: "# pass 3", source: { step: "check", command: "leave" } },
          { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "offer" } },
          {
            mark: "judged",
            words: reviewWords,
            source: { step: "review" },
            skills: [{ mode: "notes", skill: "skills/draft", tier: "balanced" }],
          },
          {
            mark: "ran",
            words: "the review ran: # pass 3",
            source: { step: "review", command: "leave", run: called },
          },
        ],
        counted: { ran: 2, computed: 1, judged: 1 },
      },
    });
    opened.close();
  });

  test("a computed line that cites a skill step is not shown", async () => {
    assert.equal(
      await refusedCard({ mark: "computed", words: reviewWords, source: { step: "review" } }),
      "Step card cannot show its card: line 1 is marked computed but cites step review, which ran the skill " +
        "skills/draft of mode notes; a computed line cites a step that ran no skill.",
    );
  });

  test("a judged line that cites a skill step the approval does not list is not shown", async () => {
    assert.equal(
      await refusedCard({ mark: "judged", words: builderWords, source: { step: "build" } }),
      "Step card cannot show its card: line 1 is marked judged but cites step build, which the approval does " +
        "not list under quotes (it lists: review, offer).",
    );
  });

  test("a judged line that cites a script step is not shown", async () => {
    assert.equal(
      await refusedCard({ mark: "judged", words: "in scope", source: { step: "offer" } }),
      "Step card cannot show its card: line 1 is marked judged but cites step offer, which ran no skill; " +
        "a judged line cites a skill step the approval lists under quotes.",
    );
  });

  test("a ran line that cites no recorded command is not shown", async () => {
    assert.equal(
      await refusedCard({ mark: "ran", words: "# pass 3", source: { step: "offer", command: "leave" } }),
      "Step card cannot show its card: line 1 is marked ran but cites the command leave of step offer, " +
        "and the kernel recorded no command leave in that step.",
    );
  });

  test("a ran line that cites a command of a run this run did not call is not shown", async () => {
    const opened = await openedCardRuns();
    const line = { mark: "ran", words: "# pass 3", source: { step: "check", command: "leave", run: opened.otherRun } };
    const { run } = await cardRun(opened, oneLine(line));
    assert.equal(
      endReason(run),
      `Step card cannot show its card: line 1 is marked ran but cites run ${opened.otherRun}, which no skill ` +
        "of step check called; a ran line cites a command of this run or of a run that one of its skills called.",
    );
    opened.close();
  });

  test("a line with a mark that is not ran, computed or judged is not shown", async () => {
    assert.equal(
      await refusedCard({ mark: "guessed", words: "fine", source: { step: "offer" } }),
      "Step card cannot show its card: line 1 has the mark guessed; a line is marked ran, computed or judged.",
    );
  });

  test("a line that cites a step that does not exist is not shown", async () => {
    assert.equal(
      await refusedCard({ mark: "computed", words: "fine", source: { step: "ghost" } }),
      "Step card cannot show its card: line 1 cites step ghost, which has not finished in this run before " +
        "the approval.",
    );
  });

  test("a judged line that names its own model is not shown: only the kernel says which skill judged", async () => {
    const line = { mark: "judged", words: reviewWords, source: { step: "review" }, model: "Claude Fable 5.2" };
    assert.equal(
      await refusedCard(line),
      "Step card cannot show its card: line 1 has the field model, which a line does not take; a line has " +
        "mark, words and source, and the kernel adds the skill and tier of a judged line, and the foreach, its " +
        "number of items and the item's name of a step in an item.",
    );
  });

  test("a builder's words reach no card, as computed or as judged, from a skill step the approval does not list", async () => {
    const computed = { mark: "computed", words: builderWords, source: { step: "build" } };
    const judged = { mark: "judged", words: builderWords, source: { step: "build" } };
    const opened = await openedCardRuns();
    const { run } = await cardRun(opened, () => ({ title: "Merge TR2?", lines: [computed, judged] }));
    assert.equal(
      endReason(run),
      "Step card cannot show its card: line 1 is marked computed but cites step build, which ran the skill " +
        "skills/draft of mode notes; a computed line cites a step that ran no skill. " +
        "Step card cannot show its card: line 2 is marked judged but cites step build, which the approval does " +
        "not list under quotes (it lists: review, offer).",
    );
    assert.equal(run.steps.find((step) => step.key === "card")?.status, "failed");
    opened.close();
  });

  test("a card is shown the same after the process ends, and checked again when what it shows changes", async () => {
    const steps: Workflow["steps"] = [
      { id: "offer", action: "pass", input: { inScope: 11 } },
      { id: "card", approval: "Merge this slice?", show: "$settings.card" },
    ];
    const sound = { title: "Merge TR2?", lines: [{ mark: "computed", words: "in scope", source: { step: "offer" } }] };
    const broken = {
      title: "Merge TR2?",
      lines: [{ mark: "ran", words: "in scope", source: { step: "offer", command: "leave" } }],
    };
    const changes = { ...withFlow(steps), notesActions: { pass } };
    const settingsWith = (card: Json): Partial<Config> => ({ settings: { notes: { greeting: "hello", card } } });
    const { runs, reopen, close } = await openedRuns({ changes: { ...changes, config: settingsWith(sound) } });
    const started = await runs.start(flow, null);
    const id = runOf(started).id;
    const first = waitingOf(started);
    assert.deepEqual(first.reason === "approval" ? first.card : undefined, {
      title: "Merge TR2?",
      lines: [{ mark: "computed", words: "in scope", source: { step: "offer" } }],
      counted: { ran: 0, computed: 1, judged: 0 },
    });
    runs.close();
    const later = await reopen();
    assert.deepEqual(waitingOf(await later.show(id)), first);
    assert.deepEqual(waitingOf(await later.resume(id)), first);
    later.close();
    const edited = await fixtureSystem({ ...changes, config: settingsWith(broken) });
    const changed = runOf(await (await reopen(edited.system)).resume(id));
    assert.equal(
      endReason(changed),
      "Step card cannot show its card: line 1 is marked ran but cites the command leave of step offer, " +
        "and the kernel recorded no command leave in that step.",
    );
    close();
  });
});
