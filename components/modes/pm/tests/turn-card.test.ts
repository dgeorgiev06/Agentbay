import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { askedQ4, askedQ5, factQ3, glossary, todoQuestions, todoTree, todoTurn } from "./todo-turn.ts";

let project: ModeProject;

before(async () => {
  project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["pm"] });
  await writeFile(join(project.root, "CONTEXT.md"), glossary, "utf8");
});

after(async () => {
  await project.close();
});

function computed(words: string): Json {
  return { mark: "computed", words, source: { step: "draw" } };
}

function judged(words: string): Json {
  return { mark: "judged", words, source: { step: "interview" } };
}

function drawn(tree: Json, turn: Json): Promise<Json> {
  return project.output("pm.draw-turn", { job: "todo", number: 2, tree, turn });
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function linesOf(card: Json): readonly Json[] {
  const lines = fieldsOf(fieldsOf(card).card ?? null).lines;
  return isList(lines) ? lines : [];
}

const allSettled = {
  questions: todoQuestions.slice(0, 2).map((question) => ({ ...question, settled: true })),
};

describe("the turn card", () => {
  test("shows the frontier's questions, numbered, each with its choices and the interviewer's recommendation as judged lines", async () => {
    assert.deepEqual(await drawn(todoTree, todoTurn), {
      card: {
        title: "Turn 2 of the todo interview: your answers?",
        lines: [
          computed("2 of 7 questions are settled. 2 can be asked now; 1 waits for them."),
          judged("Looked up for Q3, Where a mode lives: A mode is a folder with a mode.yaml."),
          computed('CONTEXT.md holds the words it rests on: "A folder with a `mode.yaml`."'),
          judged("1 Due dates in the past"),
          judged("May a todo be added with a due date that has already passed?"),
          judged(`a ${askedQ4.choices[0] ?? ""}`),
          judged(`b ${askedQ4.choices[1] ?? ""}`),
          judged(`Recommended: a. ${askedQ4.why}`),
          judged("2 Done twice"),
          judged("What happens when a todo already done is marked done again?"),
          judged(`a ${askedQ5.choices[0] ?? ""}`),
          judged(`b ${askedQ5.choices[1] ?? ""}`),
          judged(`Recommended: a. ${askedQ5.why}`),
          computed(
            "Not asked, since talking cannot settle it: Q7, How the list reads. It goes to the file as a thing a person judges.",
          ),
          computed("Answer as 1a 2b, or in your own words. Each answer is read back to you before it is kept."),
        ],
        withheld: {},
      },
      offered: { answered: true },
    });
  });

  test("says so when a fact's words are not in its file, as a line worked out by script", async () => {
    const turn = { asked: [askedQ4, askedQ5], facts: [{ ...factQ3, quote: "A folder of code." }] };
    assert.deepEqual(
      linesOf(await drawn(todoTree, turn))[2],
      computed('CONTEXT.md does not hold the words it rests on: "A folder of code."'),
    );
  });

  test("withholds answering when nothing is left to ask, and names the sign-off", async () => {
    assert.deepEqual(await drawn(allSettled, { asked: [], facts: [] }), {
      card: {
        title: "Nothing is left to ask in the todo interview",
        lines: [
          computed("2 of 2 questions are settled. 0 can be asked now; 0 wait for them."),
          computed("Run pm sign-off next: it shows what was understood, for you to sign or not."),
        ],
        withheld: { answered: "No question is left to answer." },
      },
      offered: { answered: false },
    });
  });

  test("says what the questions wait for when none can be asked yet", async () => {
    const waiting = { questions: todoQuestions.filter((question) => ["Q3", "Q6"].includes(question.id)) };
    const card = fieldsOf(fieldsOf(await drawn(waiting, { asked: [], facts: [] })).card ?? null);
    assert.equal(card.title, "Nothing can be asked yet in the todo interview");
    assert.deepEqual(card.lines, [
      computed("0 of 2 questions are settled. 0 can be asked now; 1 waits for them."),
      computed("Waiting for facts to be looked up: Q3."),
    ]);
    assert.deepEqual(card.withheld, { answered: "No question can be answered until those facts are looked up." });
  });

  test("says the scope may be too large once the interview passes sixty questions", async () => {
    const many = Array.from({ length: 61 }, (_, index) => ({
      id: `Q${String(index + 1)}`,
      title: `Question ${String(index + 1)}`,
      asks: "Which one?",
      after: [],
      kind: "decision",
      settled: index > 0,
    }));
    const turn = { asked: [{ ...askedQ4, question: "Q1" }], facts: [] };
    assert.ok(
      linesOf(await drawn({ questions: many }, turn)).some(
        (line) =>
          JSON.stringify(line) ===
          JSON.stringify(
            computed(
              "This interview has 61 questions. A scope this large may be better split into smaller files first.",
            ),
          ),
      ),
    );
  });
});
