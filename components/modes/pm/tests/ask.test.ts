import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import type { ModeProject, Run } from "../../../../tests/test-toolbox.ts";
import {
  answeredAll,
  approvalOf,
  askedTurn,
  choose,
  failureOf,
  fieldOf,
  firstTurn,
  listOf,
  openPm,
  outputOf,
  secondTurn,
  started,
  taskOf,
  type Approval,
} from "./interview-fixture.ts";

function computed(words: string): object {
  return { mark: "computed", words, source: { step: "draw" } };
}

function judged(words: string): object {
  return { mark: "judged", words, source: { step: "interview" } };
}

function shownLines(approval: Approval): readonly object[] {
  return (approval.card?.lines ?? []).map((line) => ({ mark: line.mark, words: line.words, source: line.source }));
}

function choiceStates(approval: Approval): readonly string[] {
  return (approval.choices ?? []).map((choice) => `${choice.name} ${choice.status}`);
}

const answerLine = computed("Answer with a letter, or later to keep it open for a later turn.");

async function firstTurnShown(project: ModeProject): Promise<Run> {
  await started(project);
  return project.answer(taskOf(await askedTurn(project)).token, firstTurn);
}

async function secondTurnShown(project: ModeProject, firstAnswers: readonly string[]): Promise<Run> {
  await answeredAll(project, await firstTurnShown(project), firstAnswers);
  return project.answer(taskOf(await askedTurn(project)).token, secondTurn);
}

function questionsOf(run: Run): readonly Json[] {
  return listOf(fieldOf(taskOf(run).input, "questions"));
}

test("the first turn asks the three standing questions, each on its own card, and the interviewer is given only the records", async () => {
  const project = await openPm();
  await started(project);
  const asked = await askedTurn(project);
  assert.deepEqual(fieldOf(taskOf(asked).input, "asks"), ["Q1", "Q2", "Q3"]);
  assert.deepEqual(fieldOf(taskOf(asked).input, "lookUp"), []);
  const first = approvalOf(await project.answer(taskOf(asked).token, firstTurn));
  assert.equal(first.card?.title, "Turn 1 of the todo interview, card 1 of 3");
  assert.deepEqual(shownLines(first), [
    computed("0 of 3 questions are settled. This turn asks 3 and checks 0 facts; 0 wait for them."),
    judged("Q1 Who it is for"),
    judged("Who is this work for, and what do they do with it?"),
    judged("a The owner, for short tasks"),
    judged("b A team that shares one list"),
    judged("Recommended: a. His words name no one else."),
    answerLine,
  ]);
  assert.deepEqual(choiceStates(first), ["a offered", "b offered", "c withheld", "later offered", "stop offered"]);
  await project.close();
});

test("a card with three answers offers c, and a later card carries no turn line", async () => {
  const project = await openPm();
  const second = approvalOf(await choose(project, await firstTurnShown(project), "a"));
  assert.equal(second.card?.title, "Turn 1 of the todo interview, card 2 of 3");
  assert.deepEqual(shownLines(second)[0], judged("Q2 Seen working"));
  assert.deepEqual(choiceStates(second), ["a offered", "b offered", "c offered", "later offered", "stop offered"]);
  await project.close();
});

test("the turn's answers are kept with the words of the choice taken, later keeps one open, and the next turn is named", async () => {
  const project = await openPm();
  const done = await answeredAll(project, await firstTurnShown(project), ["a", "c", "later"]);
  assert.deepEqual(outputOf(done), {
    job: "todo",
    summary:
      "Turn 1 of the interview of todo is kept: 2 questions settled, 3 open. When the owner asks for turn 2, run: " +
      `bay call --workflow pm:workflows/ask.yaml '{"job": "todo"}' --json`,
  });
  const next = await askedTurn(project);
  assert.deepEqual(fieldOf(taskOf(next).input, "asks"), ["Q3", "Q5"]);
  assert.deepEqual(fieldOf(taskOf(next).input, "lookUp"), ["Q4"]);
  assert.deepEqual(
    questionsOf(next)
      .slice(0, 3)
      .map((question) => [fieldOf(question, "settled"), fieldOf(question, "answer")]),
    [
      [true, "The owner, for short tasks"],
      [true, "Nothing until a refresh"],
      [false, null],
    ],
  );
  await project.close();
});

test("a fact is shown for the owner's yes, with what the script found in its file, and counts only on his a", async () => {
  const project = await openPm();
  const turn = await secondTurnShown(project, ["a", "a", "a"]);
  const fact = approvalOf(turn);
  assert.deepEqual(shownLines(fact), [
    computed("3 of 5 questions are settled. This turn asks 1 and checks 1 fact; 0 wait for them."),
    judged("Q4 Where a mode lives"),
    judged("Looked up: A mode is a folder with a mode.yaml."),
    computed('CONTEXT.md holds these words: "A folder with a `mode.yaml`."'),
    computed("Is it so?"),
    computed("a That is so"),
    computed("b That is not so: ask it as a question"),
    answerLine,
  ]);
  assert.deepEqual(choiceStates(fact), ["a offered", "b offered", "c withheld", "later offered", "stop offered"]);
  const done = await answeredAll(project, turn, ["a", "b"]);
  assert.match(JSON.stringify(outputOf(done)), /Nothing more can be asked; the sign-off is not built yet\./);
  assert.equal(fieldOf(outputOf(done), "next"), null);
  assert.equal(
    failureOf(await askedTurn(project)),
    "Nothing is left to ask in the interview of todo; the sign-off is not built yet.",
  );
  await project.close();
});

test("a fact the owner says is not so becomes a decision, asked of him in the next turn", async () => {
  const project = await openPm();
  await answeredAll(project, await secondTurnShown(project, ["a", "a", "a"]), ["b", "a"]);
  const next = await askedTurn(project);
  assert.deepEqual(fieldOf(taskOf(next).input, "asks"), ["Q4"]);
  await project.close();
});

test("stop on a card ends the run, keeps nothing of the turn, and no turn is asked until he starts it again", async () => {
  const project = await openPm();
  const shown = await choose(project, await firstTurnShown(project), "a");
  assert.equal(
    failureOf(await choose(project, shown, "stop")),
    "The owner stopped the interview of todo at turn 1; nothing of this turn is kept, and what was settled before stays.",
  );
  assert.match(
    failureOf(await askedTurn(project)),
    /The owner stopped the interview of todo; ask the owner to start it again with the workflow pm:workflows\/start\.yaml and the job todo\./,
  );
  await started(project);
  const again = await askedTurn(project);
  assert.deepEqual(fieldOf(taskOf(again).input, "turn"), 1);
  assert.deepEqual(fieldOf(taskOf(again).input, "asks"), ["Q1", "Q2", "Q3"]);
  await project.close();
});

test("a turn put to the owner and not answered stops the next one until he starts the interview again", async () => {
  const project = await openPm();
  await firstTurnShown(project);
  assert.match(
    failureOf(await askedTurn(project)),
    /Turn 1 of the interview of todo was put to the owner and not answered; ask the owner to start it again/,
  );
  await project.close();
});

test("with one question a turn, a turn asks the first question of the frontier only", async () => {
  const project = await openPm({ questionsPerTurn: 1 });
  await started(project);
  const asked = await askedTurn(project);
  assert.deepEqual(fieldOf(taskOf(asked).input, "asks"), ["Q1"]);
  assert.deepEqual(fieldOf(taskOf(asked).input, "perTurn"), 1);
  await project.close();
});

function waitingAfterQ3(from: number, count: number): readonly Json[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `Q${String(from + index)}`,
    title: `Question ${String(from + index)}`,
    asks: "Which one?",
    after: ["Q3"],
    kind: "decision",
    settled: false,
  }));
}

function firstAsked(): readonly Json[] {
  return listOf(fieldOf(firstTurn, "asked"));
}

async function thirdTurnLines(project: ModeProject, job: string, total: number): Promise<readonly object[]> {
  const asked = firstAsked();
  await started(project, job);
  const first = { added: waitingAfterQ3(4, 40), asked, facts: [] };
  await answeredAll(project, await project.answer(taskOf(await askedTurn(project, job)).token, first), [
    "a",
    "a",
    "later",
  ]);
  const second = { added: waitingAfterQ3(44, total - 43), asked: asked.slice(2), facts: [] };
  await answeredAll(project, await project.answer(taskOf(await askedTurn(project, job)).token, second), ["later"]);
  const third = { added: [], asked: asked.slice(2), facts: [] };
  return shownLines(approvalOf(await project.answer(taskOf(await askedTurn(project, job)).token, third)));
}

test("the card says the scope may be too large once the interview has more than sixty questions, and not at sixty", async () => {
  const project = await openPm();
  const sizeLine = computed(
    "This interview has 61 questions. A scope this large may be better split into smaller files first.",
  );
  assert.deepEqual((await thirdTurnLines(project, "large", 61))[1], sizeLine);
  assert.deepEqual((await thirdTurnLines(project, "sixty", 60))[1], judged("Q3 Left out"));
  await project.close();
});

test("a question talking cannot settle is named on the turn's first card and never asked", async () => {
  const project = await openPm();
  await started(project);
  const prototype = {
    id: "Q4",
    title: "How the list reads",
    asks: "How should the list look on a phone?",
    after: [],
    kind: "prototype",
    settled: false,
  };
  const first = { added: [prototype], asked: firstAsked(), facts: [] };
  await answeredAll(project, await project.answer(taskOf(await askedTurn(project)).token, first), ["a", "a", "later"]);
  const second = { added: [], asked: firstAsked().slice(2), facts: [] };
  const lines = shownLines(approvalOf(await project.answer(taskOf(await askedTurn(project)).token, second)));
  assert.deepEqual(
    lines[1],
    computed("Not asked, since talking cannot settle it: Q4. It goes to the file as a thing a person judges."),
  );
  await project.close();
});
