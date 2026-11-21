import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedTurn,
  choose,
  factQ4,
  failureOf,
  fieldOf,
  firstTurn,
  listOf,
  openedOf,
  openPm,
  started,
  taskOf,
  todoWords,
} from "./interview-fixture.ts";

const request = { job: "todo", words: todoWords };

test("begin called alone with a card open did not draw starts nothing, and says why", async () => {
  const project = await openPm();
  const opened = fieldsOf(await project.output("pm.open", request));
  const forged = { ...opened, card: { title: "Start an interview of todo?", lines: [], withheld: {} } };
  assert.equal(
    await project.failure("pm.begin", { choice: "start", opened: forged }),
    "Nothing was started: the card begin was given is not the start card for the interview of todo as it stands.",
  );
  await project.close();
});

test("begin called alone with the card open drew does start, recording only who the request named", async () => {
  const project = await openPm();
  const opened = await project.output("pm.open", { ...request, by: "design lead" });
  await project.output("pm.begin", { choice: "start", opened });
  const asked = listOf(fieldOf(taskOf(await askedTurn(project)).input, "asked"));
  assert.deepEqual(
    asked.map((entry) => Object.keys(fieldsOf(entry)).sort()),
    [["namedBy", "on", "words"]],
  );
  assert.equal(fieldOf(asked[0] ?? null, "namedBy"), "design lead");
  await project.close();
});

test("begin refuses to start while free-text answers are on, whatever card it is given", async () => {
  const project = await openPm({ freeTextAnswers: true });
  const opened = await project.output("pm.open", request);
  assert.equal(
    await project.failure("pm.begin", { choice: "start", opened }),
    "Nothing was started: the start card for the interview of todo does not offer start now.",
  );
  await project.close();
});

test("a stopped interview is not opened again by a start card drawn before the stop", async () => {
  const project = await openPm();
  const before = await project.output("pm.open", request);
  await started(project);
  const shown = await project.answer(taskOf(await askedTurn(project)).token, firstTurn);
  failureOf(await choose(project, shown, "stop"));
  assert.equal(
    await project.failure("pm.begin", { choice: "start", opened: before }),
    "Nothing was started: the card begin was given is not the start card for the interview of todo as it stands.",
  );
  await project.close();
});

test("record keeps nothing of a turn handed in with another turn's token", async () => {
  const project = await openPm();
  await started(project);
  const shown = await project.answer(taskOf(await askedTurn(project)).token, firstTurn);
  assert.notEqual(openedOf(shown), "made-up");
  assert.equal(
    await project.failure("pm.record", { job: "todo", opened: "made-up", turn: firstTurn, answers: [] }),
    "Nothing is kept: the turn handed to record is not the turn of the interview of todo that is open.",
  );
  await project.close();
});

test("the interview's check refuses a turn when no turn of the job is open", async () => {
  const project = await openPm();
  await started(project);
  const input = taskOf(await askedTurn(project)).input;
  const alone = await project.run("pm.interview", { ...fieldsOf(input), job: "other" });
  const ended = await project.answer(taskOf(alone).token, firstTurn);
  assert.match(failureOf(ended), /No turn of the interview of other is open, so no turn can be checked\./);
  await project.close();
});

test("a card says so, by script, when the fact's file no longer holds its words", async () => {
  const project = await openPm();
  await started(project);
  const turn: Json = { ...fieldsOf(firstTurn), added: [] };
  await project.answer(taskOf(await askedTurn(project)).token, turn);
  await writeFile(join(project.root, "CONTEXT.md"), "# Changed\n", "utf8");
  const drawn = await project.output("pm.draw", { job: "todo", turn: { added: [], asked: [], facts: [factQ4] } });
  const card = fieldOf(listOf(fieldOf(drawn, "items"))[0] ?? null, "card");
  const said = listOf(fieldOf(card, "lines")).map((line) => fieldOf(line, "words"));
  assert.ok(
    said.includes('CONTEXT.md does not hold these words: "A folder with a `mode.yaml`."'),
    JSON.stringify(said),
  );
  await project.close();
});

test("the setting questionsPerTurn takes 1 to 12 and nothing else", async () => {
  await assert.rejects(openPm({ questionsPerTurn: 13 }), /questionsPerTurn|13|maximum/);
  await assert.rejects(openPm({ questionsPerTurn: 0 }), /questionsPerTurn|0|minimum/);
  const project = await openPm({ questionsPerTurn: 12 });
  await project.close();
});
