import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { todoTurn } from "./todo-turn.ts";

let project: ModeProject;

before(async () => {
  project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["pm"] });
});

after(async () => {
  await project.close();
});

const freeAnswer = "For the first, yes,\nlist it as overdue. The second I don't know yet.";

const soundReading = [
  { question: 1, takes: "choice", letter: "a", words: "For the first, yes, list it as overdue." },
  { question: 2, takes: "unsure", words: "The second I don't know yet." },
];

function shortRead(said: string): Promise<Json> {
  return project.output("pm.read-short", { turn: todoTurn, said });
}

function checked(said: string, reading: readonly Json[]): Promise<Json> {
  return project.output("pm.check-reading", { turn: todoTurn, said, reading });
}

function feedbackOf(answer: Json): string {
  const fields = fieldsOf(answer);
  assert.equal(fields.passed, false, `the reading passed, and it should not have: ${JSON.stringify(answer)}`);
  return typeof fields.feedback === "string" ? fields.feedback : "";
}

describe("an answer in numbers and letters", () => {
  test("is read by script, each answer with the owner's own words for it", async () => {
    assert.deepEqual(await shortRead(" 1a, 2B\n"), {
      short: true,
      reading: [
        { question: 1, takes: "choice", letter: "a", words: "1a" },
        { question: 2, takes: "choice", letter: "b", words: "2B" },
      ],
    });
  });

  test("leaves a question he did not answer out of the reading", async () => {
    assert.deepEqual(await shortRead("2a"), {
      short: true,
      reading: [{ question: 2, takes: "choice", letter: "a", words: "2a" }],
    });
  });

  for (const said of ["agree with the recommendations", "1a 3b", "1c", "1a 1b", "1 a", ""]) {
    test(`is not read by script when it is ${JSON.stringify(said)}, so a model reads it and it is read back`, async () => {
      assert.deepEqual(await shortRead(said), { short: false });
    });
  }
});

describe("the check of a reading", () => {
  test("passes a reading whose words for each answer are the owner's own, whatever the spaces between them", async () => {
    assert.deepEqual(await checked(freeAnswer, soundReading), { passed: true });
  });

  test("sends back words the owner did not say", async () => {
    const reading = [{ question: 1, takes: "choice", letter: "a", words: "Yes, list it as overdue." }];
    assert.match(
      feedbackOf(await checked(freeAnswer, reading)),
      /The reading of question 1 gives the words "Yes, list it as overdue\.", which the owner did not say; give his words exactly\./,
    );
  });

  test("sends back a letter its question does not have, and a letter for an answer that takes none", async () => {
    const reading = [
      { question: 1, takes: "choice", letter: "c", words: "For the first, yes" },
      { question: 2, takes: "own", letter: "a", words: "The second I don't know yet." },
    ];
    const feedback = feedbackOf(await checked(freeAnswer, reading));
    assert.match(feedback, /Question 1 has the choices a and b, not c\./);
    assert.match(
      feedback,
      /The reading of question 2 takes own and names the letter a; only a choice names a letter\./,
    );
  });

  test("sends back a choice with no letter", async () => {
    const reading = [{ question: 1, takes: "choice", words: "For the first, yes" }];
    assert.match(
      feedbackOf(await checked(freeAnswer, reading)),
      /The reading of question 1 takes a choice and names no letter; name the letter he chose\./,
    );
  });

  test("sends back a question the turn does not have, and a question read twice", async () => {
    const reading = [soundReading[0] ?? null, soundReading[0] ?? null, { question: 3, takes: "unsure", words: "yes" }];
    const feedback = feedbackOf(await checked(freeAnswer, reading));
    assert.match(feedback, /Question 1 is read twice; read each question once\./);
    assert.match(feedback, /The turn has 2 questions, so there is no question 3\./);
  });
});
