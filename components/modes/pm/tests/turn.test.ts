import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { askedQ4, askedQ5, factQ3, glossary, todoQuestions, todoTree, todoTurn } from "./todo-turn.ts";

let project: ModeProject;

before(async () => {
  project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["pm"] });
  await writeFile(join(project.root, "CONTEXT.md"), glossary, "utf8");
  await mkdir(join(project.root, "docs"), { recursive: true });
});

after(async () => {
  await project.close();
});

function feedbackOf(checked: Json): string {
  const fields = fieldsOf(checked);
  assert.equal(fields.passed, false, `the turn passed, and it should not have: ${JSON.stringify(checked)}`);
  return typeof fields.feedback === "string" ? fields.feedback : "";
}

function withQuestions(questions: readonly Json[]): Json {
  return { questions };
}

function decisions(count: number): readonly Json[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `Q${String(index + 1)}`,
    title: `Question ${String(index + 1)}`,
    asks: "Which one?",
    after: [],
    kind: "decision",
    settled: false,
  }));
}

describe("the frontier", () => {
  test("holds each open decision whose earlier questions are all settled, and counts the rest", async () => {
    assert.deepEqual(await project.output("pm.frontier", { tree: todoTree }), {
      frontier: ["Q4", "Q5"],
      asks: ["Q4", "Q5"],
      lookUp: ["Q3"],
      untalkable: ["Q7"],
      settled: 2,
      waiting: 1,
      total: 7,
      problems: [],
    });
  });

  test("asks only its first question when the owner asked for one at a time", async () => {
    const answer = fieldsOf(await project.output("pm.frontier", { tree: todoTree, oneAtATime: true }));
    assert.deepEqual(answer.asks, ["Q4"]);
  });

  test("asks at most twelve questions in one turn, the first twelve in the tree's order", async () => {
    const answer = fieldsOf(await project.output("pm.frontier", { tree: withQuestions(decisions(14)) }));
    assert.equal(Array.isArray(answer.frontier) ? answer.frontier.length : 0, 14);
    assert.deepEqual(
      answer.asks,
      decisions(12).map((question) => fieldsOf(question).id),
    );
  });

  test("names a question that comes after one the tree does not have, and questions that wait on each other", async () => {
    const questions = [
      ...decisions(1),
      { id: "Q2", title: "Two", asks: "Which?", after: ["Q9"], kind: "decision", settled: false },
      { id: "Q3", title: "Three", asks: "Which?", after: ["Q4"], kind: "decision", settled: false },
      { id: "Q4", title: "Four", asks: "Which?", after: ["Q3"], kind: "decision", settled: false },
      { id: "Q1", title: "Again", asks: "Which?", after: [], kind: "decision", settled: false },
    ];
    const answer = fieldsOf(await project.output("pm.frontier", { tree: withQuestions(questions) }));
    assert.deepEqual(answer.problems, [
      "Q1 is in the tree twice; give each question its own id.",
      "Q2 comes after Q9, which is not in the tree; add Q9 or take it out of Q2's after.",
      "Q3 and Q4 come after each other, so none of them can ever be asked; take one of them out of another's after.",
    ]);
    assert.deepEqual(answer.frontier, ["Q1"]);
  });
});

describe("the check of a turn", () => {
  test("passes a turn that asks the whole frontier, each with a recommended choice, and gives each fact with its source", async () => {
    assert.deepEqual(await project.output("pm.check-turn", { tree: todoTree, turn: todoTurn }), { passed: true });
  });

  test("sends back a turn that leaves out a question of the frontier or asks one that waits", async () => {
    const q6 = { ...askedQ4, question: "Q6" };
    const feedback = feedbackOf(
      await project.output("pm.check-turn", { tree: todoTree, turn: { asked: [askedQ4, q6], facts: [factQ3] } }),
    );
    assert.match(feedback, /Q5 can be asked now and the turn does not ask it; ask it\./);
    assert.match(feedback, /Q6 cannot be asked yet: it comes after Q3 and Q4, which are not settled\./);
  });

  test("sends back a recommendation that names no choice of its question", async () => {
    const turn = { asked: [{ ...askedQ4, recommended: "c" }, askedQ5], facts: [factQ3] };
    const feedback = feedbackOf(await project.output("pm.check-turn", { tree: todoTree, turn }));
    assert.match(feedback, /Q4 recommends c, but it has 2 choices, a and b; recommend one of them\./);
  });

  test("sends back a question asked twice", async () => {
    const turn = { asked: [askedQ4, askedQ5, askedQ4], facts: [factQ3] };
    const feedback = feedbackOf(await project.output("pm.check-turn", { tree: todoTree, turn }));
    assert.match(feedback, /Q4 is asked twice in the turn; ask it once\./);
  });

  test("sends back a fact, a question talking cannot settle, or a settled one put to the owner", async () => {
    const turn = {
      asked: [
        askedQ4,
        askedQ5,
        { ...askedQ4, question: "Q3" },
        { ...askedQ4, question: "Q7" },
        { ...askedQ4, question: "Q1" },
      ],
      facts: [factQ3],
    };
    const feedback = feedbackOf(await project.output("pm.check-turn", { tree: todoTree, turn }));
    assert.match(
      feedback,
      /Q3 is a fact: look it up and give it under facts, with its file and the words it rests on\./,
    );
    assert.match(feedback, /Q7 is one talking cannot settle; leave it out of the turn\./);
    assert.match(feedback, /Q1 is settled; ask it no more\./);
  });

  test("sends back a fact whose words its file does not hold, or that answers a decision", async () => {
    const turn = {
      asked: [askedQ4, askedQ5],
      facts: [
        { ...factQ3, quote: "A folder with a manifest." },
        { ...factQ3, question: "Q5" },
        { ...factQ3, source: "docs/missing.md" },
      ],
    };
    const feedback = feedbackOf(await project.output("pm.check-turn", { tree: todoTree, turn }));
    assert.match(
      feedback,
      /The fact for Q3 quotes "A folder with a manifest\.", which CONTEXT\.md does not hold; quote its words exactly\./,
    );
    assert.match(feedback, /Q5 is a decision, which is the owner's; ask it, and give no fact for it\./);
    assert.match(feedback, /The fact for Q3 names docs\/missing\.md, which cannot be read: /);
  });

  test("sends back a turn given a tree with a problem, naming the tree's problem", async () => {
    const tree = withQuestions([...todoQuestions, todoQuestions[0] ?? null]);
    const feedback = feedbackOf(await project.output("pm.check-turn", { tree, turn: todoTurn }));
    assert.match(feedback, /Q1 is in the tree twice; give each question its own id\./);
  });
});
