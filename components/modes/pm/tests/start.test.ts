import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answeredAll,
  approvalOf,
  askedTurn,
  choose,
  failureOf,
  fieldOf,
  firstTurn,
  openPm,
  outputOf,
  started,
  taskOf,
  todoWords,
} from "./interview-fixture.ts";

function computed(words: string): object {
  return { mark: "computed", words, source: { step: "open" } };
}

const whatItDoes =
  "It asks you questions a turn at a time, at most 12 a turn, each on its own card with lettered answers and a " +
  "recommendation. What you answer is kept by the PM mode; no file is written.";

test("the start card shows his words and what the interview does, and start begins it and names its first turn", async () => {
  const project = await openPm();
  const opened = await project.runWorkflow("pm", "workflows/start.yaml", { job: "todo", words: todoWords });
  const approval = approvalOf(opened);
  assert.deepEqual(
    (approval.card?.lines ?? []).map((line) => ({ mark: line.mark, words: line.words, source: line.source })),
    [computed(`Your words: "${todoWords}"`), computed(whatItDoes)],
  );
  assert.equal(approval.card?.title, "Start an interview of todo?");
  assert.deepEqual(outputOf(await choose(project, opened, "start")), {
    job: "todo",
    summary:
      "The interview of todo is started. When the owner asks for its turn 1, run: " +
      `bay call --workflow pm:workflows/ask.yaml '{"job": "todo"}' --json`,
  });
  await project.close();
});

test("stop starts nothing, and no turn can be asked of an interview the owner did not start", async () => {
  const project = await openPm();
  const opened = await project.runWorkflow("pm", "workflows/start.yaml", { job: "todo", words: todoWords });
  assert.equal(
    failureOf(await choose(project, opened, "stop")),
    "Nothing was started: the owner chose stop on the card for the interview of todo.",
  );
  assert.match(
    failureOf(await askedTurn(project)),
    /No interview of todo was started; only the owner starts one, with the workflow pm:workflows\/start\.yaml\./,
  );
  await project.close();
});

test("with free-text answers on, the start card withholds start and says why", async () => {
  const project = await openPm({ freeTextAnswers: true });
  const opened = await project.runWorkflow("pm", "workflows/start.yaml", { job: "todo", words: todoWords });
  assert.deepEqual(
    approvalOf(opened).choices?.find((choice) => choice.name === "start"),
    {
      name: "start",
      status: "withheld",
      does: "Start the interview; its first turn comes next",
      reason:
        "Free-text answers are on in settings.pm, and they are not built yet; set freeTextAnswers to false to start.",
    },
  );
  await project.close();
});

test("the start card says how many questions a turn asks from the setting", async () => {
  const project = await openPm({ questionsPerTurn: 3 });
  const opened = await project.runWorkflow("pm", "workflows/start.yaml", { job: "todo", words: todoWords });
  assert.match(approvalOf(opened).card?.lines[1]?.words ?? "", /at most 3 a turn/);
  await project.close();
});

test("starting an interview again keeps what was settled, says so, and adds his new words", async () => {
  const project = await openPm();
  await started(project);
  const turn = await project.answer(taskOf(await askedTurn(project)).token, firstTurn);
  await answeredAll(project, turn, ["a", "a", "later"]);
  const again = await project.runWorkflow("pm", "workflows/start.yaml", { job: "todo", words: "Overdue first." });
  assert.equal(
    approvalOf(again).card?.lines[1]?.words,
    "The interview of todo has 2 of 5 questions settled. Starting again keeps what is settled and asks the open ones.",
  );
  await choose(project, again, "start");
  const input = taskOf(await askedTurn(project)).input;
  assert.deepEqual(fieldOf(input, "turn"), 2);
  assert.match(JSON.stringify(fieldOf(input, "asked")), /Overdue first\./);
  assert.deepEqual(fieldOf(input, "asks"), ["Q3", "Q5"]);
  await project.close();
});
