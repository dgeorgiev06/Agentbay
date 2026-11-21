import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import {
  bay,
  decided,
  git,
  into,
  kitTemplate,
  playedTo,
  printedCard,
  project,
  removeAll,
  runOf,
  shown,
  textAt,
  waitingOf,
} from "./kit-copy.ts";
import { answeredTodo, nextIdNotGiven } from "./todo-answered.ts";

const file = "docs/requirements/todo.yaml";

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

function allHeld(task: Json): Json {
  const practices = listOf(fieldsOf(fieldsOf(task).input ?? null).practices);
  const answers = practices.map((practice) => ({
    id: textAt(practice, "id"),
    answer: "held",
    sentence: "Checked each action against the rule it applies.",
  }));
  return { chosen: "first", because: "It is the only design.", practices: answers };
}

async function startedOnTheLightPath(root: string): Promise<string> {
  const started = runOf(
    await bay(root, ["call", "--workflow", "forge:workflows/design.yaml", JSON.stringify({ file })]),
  );
  const start = waitingOf(started, "path");
  await decided(root, start, { step: "path", choice: "light" });
  return start.id;
}

const ruleRows = [
  "  rule add, in todo: takes request, todos",
  "    from todos, next-id from todo-ids; gives",
  "    todos into todos, next-id into todo-ids,",
  "    answer",
];

const addRows = [
  "  add: serves O1-C1, O1-C4, O1-C5, O1-C6,",
  "    O1-C7, O2-C4; applies the rule add,",
  "    reads todos and todo-ids, writes todos",
  "    and todo-ids; 7 examples",
];

const spelledRows = ["  examples that say a long text by rule: 5,", "    spelled out by forge before any check"];

function rowsAt(printed: readonly string[], rows: readonly string[]): number {
  return printed.findIndex((_, at) => rows.every((row, index) => printed[at + index] === row));
}

describe("a design that states its rules, through the workflow design", { concurrency: true }, () => {
  test("the answered todo design shows each rule and what each action reads and writes, and its commit keeps the rules and the short texts", async () => {
    const root = await project(template);
    const runId = await startedOnTheLightPath(root);
    await playedTo(root, runId, {
      designer: () => Promise.resolve(answeredTodo),
      challenger: (task) => Promise.resolve(allHeld(task)),
    });
    const printed = await printedCard(root, runId, "Commit the design");
    for (const rows of [ruleRows, addRows, spelledRows]) {
      assert.ok(rowsAt(printed, rows) >= 0, printed.join("\n"));
    }
    assert.ok(printed.includes("judged   add decides: Whether a text may be"), printed.join("\n"));
    assert.ok(printed.includes("  checked by script: 24 checks of the"), printed.join("\n"));
    const card = waitingOf(await shown(root, runId), "card");
    assert.equal(textAt(runOf(await decided(root, card, { step: "card", choice: "approve" })), "status"), "done");
    const committed = readYaml(git(root, ["show", `${into}:docs/designs/todo/design.yaml`]));
    assert.ok(committed.ok);
    const [module = null] = listOf(fieldsOf(committed.value).modules);
    const [answered = null] = listOf(fieldsOf(answeredTodo).modules);
    assert.deepEqual(fieldsOf(module).rules, fieldsOf(answered).rules);
    const [todo = null] = listOf(fieldsOf(committed.value).interfaces);
    const [add = null] = listOf(fieldsOf(todo).actions);
    assert.deepEqual(
      [fieldsOf(add).rule, fieldsOf(add).reads, fieldsOf(add).writes],
      ["add", ["todos", "todo-ids"], ["todos", "todo-ids"]],
    );
    const [, longest = null] = listOf(fieldsOf(add).examples);
    assert.deepEqual(fieldsOf(longest).input, { text: { $text: [{ repeat: "a", times: 500 }] } });
  });

  test("an add rule that does not give the next id goes back to its designer with the ids table named, and the answer that gives it passes", async () => {
    const root = await project(template);
    const runId = await startedOnTheLightPath(root);
    const feedback: Json[] = [];
    await playedTo(root, runId, {
      designer: (task) => {
        feedback.push(fieldsOf(task).feedback ?? null);
        return Promise.resolve(feedback.length === 1 ? nextIdNotGiven : answeredTodo);
      },
      challenger: (task) => Promise.resolve(allHeld(task)),
    });
    assert.deepEqual(feedback, [
      [],
      [
        'The action "todo.add" writes "todo-ids", which its rule "add" does not give; let the rule give ' +
          "everything the action writes, so the thin function around it works nothing out (P-52).",
      ],
    ]);
    assert.notEqual(waitingOf(await shown(root, runId), "card").hash, "");
  });
});
