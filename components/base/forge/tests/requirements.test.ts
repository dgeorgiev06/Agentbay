import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

type Replacement = readonly [string | RegExp, string];

const todoFile = "docs/requirements/todo.yaml";

const kitTodo = join(import.meta.dirname, "..", "..", "..", "..", todoFile);

const thenOfListingNone = "        then: 0 todos are listed\n";

const secondOfFirst = `      - id: O1-C2
        path: works
        given: the todos "buy milk" and "call the bank" were added in that order
        when: the person lists the open todos
        then: the list is "buy milk" first and "call the bank" second
`;

const conditionsOfSecond = /( {4}conditions:\n)( {6}- id: O2-C1\n[\s\S]*?)(judged:\n)/;

let project: ModeProject;

let todo: string;

before(async () => {
  todo = await readFile(kitTodo, "utf8");
  const config = { modes: ["forge"], bindings: { toolchain: "typescript" }, adapter: "claude-code" };
  project = await openModeProject(config);
});

after(async () => {
  await project.close();
});

function changed(text: string, replacements: readonly Replacement[]): string {
  return replacements.reduce((before, [from, to]) => {
    const next = before.replace(from, to);
    assert.notEqual(next, before, `the todo file no longer holds ${String(from)}`);
    return next;
  }, text);
}

async function checked(text: string): Promise<Json> {
  await mkdir(join(project.root, "docs", "requirements"), { recursive: true });
  await writeFile(join(project.root, todoFile), text, "utf8");
  return project.output("requirements.check", { file: todoFile });
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function idsOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value.map((entry) => fieldsOf(entry).id ?? null) : [];
}

test("in a project that lists only forge, the brought requirements mode accepts docs/requirements/todo.yaml and hands back its outcomes and conditions by id", async () => {
  const answer = fieldsOf(await checked(todo));
  assert.equal(answer.answer, "accepted", JSON.stringify(answer));
  const outcomes = fieldsOf(answer.requirements ?? null).outcomes;
  assert.ok(isList(outcomes));
  assert.deepEqual(idsOf(outcomes), ["O1", "O2"]);
  assert.deepEqual(
    outcomes.map((outcome) => idsOf(fieldsOf(outcome).conditions)),
    [
      ["O1-C1", "O1-C2", "O1-C3", "O1-C4", "O1-C5", "O1-C6", "O1-C7"],
      ["O2-C1", "O2-C2", "O2-C3", "O2-C4", "O2-C5", "O2-C6"],
    ],
  );
});

test("the check refuses the todo file with a condition with no then, naming the condition's line", async () => {
  const answer = await checked(changed(todo, [[thenOfListingNone, ""]]));
  assert.deepEqual(answer, {
    answer: "refused",
    file: todoFile,
    problems: [
      {
        rule: "not the form",
        line: 27,
        sentence: "O1-C3: outcomes.0.conditions.2 is missing the required field then. Add then.",
      },
    ],
  });
});

test("the check refuses the todo file with two conditions with one id, naming the second's line", async () => {
  const answer = await checked(changed(todo, [[secondOfFirst, `${secondOfFirst}${secondOfFirst}`]]));
  assert.deepEqual(answer, {
    answer: "refused",
    file: todoFile,
    problems: [
      {
        rule: "id used twice",
        line: 27,
        sentence:
          "The id O1-C2 is given twice: to condition 2 of outcome 1 and to condition 3 of outcome 1. " +
          "Give each its own id, since forge and the tests name each by it.",
      },
    ],
  });
});

test("the check refuses the todo file with an outcome with no condition, naming its line", async () => {
  const text = changed(todo, [
    [conditionsOfSecond, "    conditions: []\n$3"],
    [", O2-C1, O2-C2, O2-C3, O2-C4, O2-C5, O2-C6]", "]"],
  ]);
  const answer = await checked(text);
  assert.deepEqual(answer, {
    answer: "refused",
    file: todoFile,
    problems: [
      {
        rule: "not the form",
        line: 58,
        sentence: "O2: outcomes.1.conditions must list at least 1 entry, but it lists fewer.",
      },
    ],
  });
});
