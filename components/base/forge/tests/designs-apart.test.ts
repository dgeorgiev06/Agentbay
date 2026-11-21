import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import {
  bay,
  decided,
  filesHolding,
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
import { alreadyDone, noTodo99, todoDesign, todoHides } from "./todo-design.ts";

const file = "docs/requirements/todo.yaml";

const firstLines = [todoHides, alreadyDone, noTodo99];

const secondHides = "Which todos are open and which are done, by id.";

function secondOf(first: Json): Json {
  const text = JSON.stringify(first)
    .replaceAll(todoHides, secondHides)
    .replaceAll(alreadyDone, "Todo 1 was done before.")
    .replaceAll(noTodo99, "There is no todo 99.")
    .replaceAll('"name":"todo","hides"', '"name":"todo-list","hides"');
  const read = readYaml(text);
  assert.ok(read.ok);
  return read.value;
}

const secondDesign = secondOf(todoDesign);

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

type Seen = {
  readonly holding: readonly string[];
  readonly inTask: boolean;
};

async function untrackedHolding(root: string): Promise<readonly string[]> {
  const tracked = new Set(git(root, ["ls-files"]).split("\n"));
  const holding = await filesHolding(root, "", firstLines);
  return holding.filter((path) => !tracked.has(path));
}

async function seenBy(root: string, task: Json): Promise<Seen> {
  const shownTask = JSON.stringify(task);
  return {
    holding: await untrackedHolding(root),
    inTask: firstLines.some((line) => shownTask.includes(line)),
  };
}

const answeredHides = "Which todos are open and which are done, by id, behind pure rules.";

const answeredDesign = readYaml(JSON.stringify(secondDesign).replaceAll(secondHides, answeredHides));

function chosen(task: Json): Json {
  const input = fieldsOf(fieldsOf(task).input ?? null);
  const practices = listOf(input.practices).map((practice) => {
    const id = textAt(practice, "id");
    const first = id === "P-52" && input.answered === undefined;
    return first
      ? { id, answer: "not-held", sentence: "The module todo-list names no pure function for its rules." }
      : { id, answer: "held", sentence: "It holds." };
  });
  const choice = input.answered === undefined ? "second" : "first";
  return { chosen: choice, because: "It names the module for the list it keeps.", practices };
}

test("on the full path the second designer's task holds nothing of the first design, and no file holds it while the second works", async () => {
  const root = await project(template);
  const startedRun = runOf(
    await bay(root, ["call", "--workflow", "forge:workflows/design.yaml", JSON.stringify({ file })]),
  );
  const start = waitingOf(startedRun, "path");
  await decided(root, start, { step: "path", choice: "full" });
  const designers: Json[] = [];
  const whileSecond: Seen[] = [];
  const whileChallenged: Seen[] = [];
  await playedTo(root, start.id, {
    designer: async (task) => {
      designers.push(task);
      if (designers.length === 1) {
        return todoDesign;
      }
      if (designers.length === 2) {
        whileSecond.push(await seenBy(root, task));
        return secondDesign;
      }
      assert.ok(answeredDesign.ok);
      return answeredDesign.value;
    },
    challenger: async (task) => {
      whileChallenged.push(await seenBy(root, task));
      return chosen(task);
    },
  });
  assert.equal(designers.length, 3);
  assert.deepEqual(whileSecond, [{ holding: [], inTask: false }]);
  const stances = designers.map((task) => textAt(fieldsOf(task).input ?? null, "stance"));
  assert.notEqual(stances[0], stances[1]);
  assert.equal(stances[2], stances[1]);
  const answering = fieldsOf(fieldsOf(fieldsOf(designers[2] ?? null).input ?? null).answering ?? null);
  assert.deepEqual(answering.design, secondDesign);
  assert.deepEqual(
    whileChallenged.map((seen) => seen.inTask),
    [true, false],
  );
  assert.ok(whileChallenged[0]?.holding.includes(".agentbay/kernel.db"), JSON.stringify(whileChallenged));
  const card = waitingOf(await shown(root, start.id), "card");
  const printed = (await printedCard(root, start.id, "Commit the design")).join(" ").replace(/ {2,}/g, " ");
  assert.match(printed, /the second design of two written apart, answered once after the first challenge;/);
  assert.match(printed, /where the two designs differed: 4 module todo: only in the first design/);
  assert.match(printed, /module todo-list: only in the second design todo.done: 2 examples changed todo.remove: 1/);
  assert.match(printed, /judged chosen because: It names the/);
  const done = runOf(await decided(root, card, { step: "card", choice: "approve" }));
  assert.equal(textAt(done, "status"), "done", JSON.stringify(done));
  const committed = git(root, ["show", `${into}:docs/designs/todo/design.yaml`]);
  assert.ok(committed.includes(answeredHides));
  assert.ok(!committed.includes(todoHides));
});

test("on the full path with nothing found, no designer is asked again and approve commits the design the challenger chose", async () => {
  const root = await project(template);
  const startedRun = runOf(
    await bay(root, ["call", "--workflow", "forge:workflows/design.yaml", JSON.stringify({ file })]),
  );
  const start = waitingOf(startedRun, "path");
  await decided(root, start, { step: "path", choice: "full" });
  const asked = await playedTo(root, start.id, {
    designer: (task) =>
      Promise.resolve(textAt(fieldsOf(task).input ?? null, "stance").startsWith("Split") ? secondDesign : todoDesign),
    challenger: (task) => {
      const practices = listOf(fieldsOf(fieldsOf(task).input ?? null).practices).map((practice) => ({
        id: textAt(practice, "id"),
        answer: "held",
        sentence: "It holds.",
      }));
      return Promise.resolve({ chosen: "second", because: "It names the module for the list it keeps.", practices });
    },
  });
  assert.deepEqual(
    asked.map((each) => each.action),
    ["design", "design", "challenge"],
  );
  const card = waitingOf(await shown(root, start.id), "card");
  const done = runOf(await decided(root, card, { step: "card", choice: "approve" }));
  assert.equal(textAt(done, "status"), "done", JSON.stringify(done));
  const committed = git(root, ["show", `${into}:docs/designs/todo/design.yaml`]);
  assert.ok(committed.includes(secondHides));
  assert.ok(!committed.includes(todoHides));
});
