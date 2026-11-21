import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { exampleChecks, examplesSpelled } from "../scripts/lib/design-examples.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { designProblems } from "../scripts/lib/design-rules.ts";
import { listOf, textOf } from "../scripts/lib/json-values.ts";
import { answeredTodo, nextIdNotGiven } from "./todo-answered.ts";

const file = "docs/requirements/todo.yaml";

const conditions = [
  ...["O1-C1", "O1-C2", "O1-C3", "O1-C4", "O1-C5", "O1-C6", "O1-C7"],
  ...["O2-C1", "O2-C2", "O2-C3", "O2-C4", "O2-C5", "O2-C6"],
];

function problemsOf(design: Json): readonly string[] {
  return designProblems({ job: "todo", file, conditions, design: designOf(design) });
}

function listAt(value: Json, key: string): readonly Json[] {
  return listOf(fieldsOf(value)[key]);
}

function actionChanged(design: Json, name: string, change: Record<string, Json>): Json {
  const [todo = null] = listAt(design, "interfaces");
  const actions = listAt(todo, "actions").map((action) =>
    fieldsOf(action).name === name ? { ...fieldsOf(action), ...change } : action,
  );
  return { ...fieldsOf(design), interfaces: [{ ...fieldsOf(todo), actions }] };
}

function moduleChanged(design: Json, change: (module: Record<string, Json>) => Record<string, Json>): Json {
  const [module = null] = listAt(design, "modules");
  return { ...fieldsOf(design), modules: [change(fieldsOf(module))] };
}

function ruleChanged(design: Json, name: string, change: Record<string, Json>): Json {
  return moduleChanged(design, (module) => ({
    ...module,
    rules: listOf(module.rules).map((rule) => (fieldsOf(rule).name === name ? { ...fieldsOf(rule), ...change } : rule)),
  }));
}

function withoutRules(design: Json, names: readonly string[]): Json {
  return moduleChanged(design, (module) => ({
    ...module,
    rules: listOf(module.rules).filter((rule) => !names.includes(textOf(fieldsOf(rule).name))),
  }));
}

function valuesOf(design: Json, rule: string, side: "takes" | "gives"): readonly Json[] {
  const [module = null] = listAt(design, "modules");
  const found = listAt(module, "rules").find((each) => fieldsOf(each).name === rule) ?? null;
  return listAt(found, side);
}

describe("a design states its rules, and the check holds each action to the rule it applies", () => {
  test("the answered todo design, whose add rule gives the next id, passes every check", () => {
    assert.deepEqual(problemsOf(answeredTodo), []);
  });

  test("when the add rule does not give the next id, the ids table the action writes is named", () => {
    assert.deepEqual(problemsOf(nextIdNotGiven), [
      'The action "todo.add" writes "todo-ids", which its rule "add" does not give; let the rule give everything the action writes, so the thin function around it works nothing out (P-52).',
    ]);
  });

  test("an action that writes or refuses and applies no rule, and one that only reads, which needs none", () => {
    const unruled = withoutRules(answeredTodo, ["add", "list-todos"]);
    const design = actionChanged(actionChanged(unruled, "add", { rule: null }), "list", { rule: null });
    assert.deepEqual(problemsOf(design), [
      'The action "todo.add" writes "todos" and "todo-ids" and refuses in an example but applies no rule; name in rule the pure function that decides what it answers, refuses and writes (P-52).',
    ]);
    const refusesOnly = actionChanged(design, "add", { writes: [] });
    assert.ok(
      problemsOf(refusesOnly).includes(
        'The action "todo.add" refuses in an example but applies no rule; name in rule the pure function that decides what it answers, refuses and writes (P-52).',
      ),
    );
  });

  test("an action that applies a rule no module has, and a rule no action applies", () => {
    const design = actionChanged(answeredTodo, "done", { rule: "finish" });
    assert.deepEqual(problemsOf(design), [
      'The action "todo.done" applies the rule "finish", which no module of the design has; add it to rules of the module that offers the action, or name a rule it has.',
      'The rule "mark-done" of the module "todo" is applied by no action; name it in rule of the action that applies it, or take it out.',
    ]);
  });

  test("a rule that takes what the action does not read, and an action that reads what its rule does not take", () => {
    const design = actionChanged(answeredTodo, "add", { reads: ["todos"] });
    assert.deepEqual(problemsOf(design), [
      'The rule "add" takes a value stored in "todo-ids", which the action "todo.add" does not read; name it in reads, or take it out of takes.',
    ]);
    const reading = actionChanged(answeredTodo, "done", { reads: ["todos", "todo-ids"] });
    assert.deepEqual(problemsOf(reading), [
      'The action "todo.done" reads "todo-ids", which its rule "mark-done" does not take; hand it to the rule, so the thin function decides nothing, or take it out of reads.',
    ]);
  });

  test("a rule that gives a stored value the action does not write", () => {
    const design = actionChanged(answeredTodo, "add", { writes: ["todos"] });
    assert.deepEqual(problemsOf(design), [
      'The rule "add" gives a value stored in "todo-ids", which the action "todo.add" does not write; name it in writes, or take it out of gives.',
    ]);
  });

  test("stores another module owns, or none owns, and a table nobody reads or writes", () => {
    const reads = actionChanged(answeredTodo, "list", { reads: ["todos", "archive"] });
    const stored = ruleChanged(reads, "list-todos", {
      takes: [...valuesOf(answeredTodo, "list-todos", "takes"), { name: "old", store: "archive", schema: {} }],
    });
    const owned = moduleChanged(stored, (module) => ({ ...module, owns: { tables: ["todos", "todo-ids", "log"] } }));
    assert.deepEqual(problemsOf(owned), [
      'The action "todo.list" reads "archive", which the module "todo" does not own; name only the tables and files of the module that offers it.',
      'The rule "list-todos" takes a value stored in "archive", which the module "todo" does not own; name only a table or a file of its own module in store.',
      'The table "log" of the module "todo" is read and written by no action; name it in reads or writes of the actions that use it, or take it out of owns.',
    ]);
  });

  test("a rule held by a module that does not offer the action's interface", () => {
    const [module = null] = listAt(answeredTodo, "modules");
    const keeper = { name: "ledger", hides: "How a todo's rules are decided.", implements: ["ledger"] };
    const count = {
      name: "count",
      request: {},
      response: {},
      serves: [],
      because: "An operator counts.",
      examples: [{ input: {}, answer: {} }],
    };
    const design = {
      ...fieldsOf(answeredTodo),
      modules: [
        { ...fieldsOf(module), rules: [] },
        { ...keeper, rules: listAt(module, "rules") },
      ],
      interfaces: [...listAt(answeredTodo, "interfaces"), { name: "ledger", actions: [count] }],
    };
    const problems = problemsOf(design);
    assert.ok(
      problems.includes(
        'The action "todo.add" applies the rule "add" of the module "ledger", which does not offer the interface "todo"; let the module that offers the action hold its rule.',
      ),
    );
    assert.ok(
      problems.includes(
        'The rule "add" takes a value stored in "todos", which the module "ledger" does not own; name only a table or a file of its own module in store.',
      ),
    );
  });

  test("rules and values named twice", () => {
    const [add = null] = valuesOf(answeredTodo, "add", "takes");
    const twice = ruleChanged(answeredTodo, "add", { takes: [...valuesOf(answeredTodo, "add", "takes"), add] });
    const design = moduleChanged(twice, (module) => ({
      ...module,
      rules: [...listOf(module.rules), listOf(module.rules)[1] ?? null],
    }));
    assert.deepEqual(problemsOf(design), [
      'The design has two rules named "list-todos"; give each rule a name of its own.',
      'The rule "add" takes two values named "request"; give each value a name of its own.',
    ]);
  });

  test("a rule's schema refers only to itself or to a schema file of an interface its module implements", () => {
    const [todos = null] = valuesOf(answeredTodo, "mark-done", "gives");
    const answer = {
      name: "answer",
      schema: { items: [{ $ref: "../todo.ts" }, { $ref: "schemas/todo/done-response.json#/x" }] },
    };
    const outside = ruleChanged(answeredTodo, "mark-done", { gives: [todos, answer] });
    assert.deepEqual(problemsOf(outside), [
      `The schema of the value "answer" of the rule "mark-done" refers to "../todo.ts"; a rule's schema refers only to a part of itself (#/...) or to a schema file of an interface its module implements, such as schemas/todo/add-request.json.`,
    ]);
  });
});

describe("long texts said by rule in the answered design's examples", () => {
  test("five examples say a text by rule, and each is checked spelled out, at its length in code points", () => {
    const design = designOf(answeredTodo);
    assert.equal(examplesSpelled(design), 5);
    const long = exampleChecks(design)
      .map((check) => textOf(fieldsOf(check.value).text))
      .filter((text) => text.length > 100);
    assert.deepEqual(
      long.map((text) => Array.from(text).length),
      [500, 500, 500, 500, 500, 501],
    );
  });

  test("a form past the bound is a problem of the design, and its example is not checked against the schema", () => {
    const past = { $text: [{ repeat: "a", times: 10_001 }] };
    const design = actionChanged(answeredTodo, "list", {
      examples: [
        { earlier: [{ action: "add", input: { text: past } }], input: { status: "open" }, answer: { todos: [] } },
      ],
    });
    assert.deepEqual(problemsOf(design), [
      'In example 1 of "todo.list", the input of earlier call 1 says a text by rule that forge cannot spell out: it spells 10,001 characters, counted in Unicode code points, and a text said by rule spells at most 10,000.',
    ]);
    const checked = exampleChecks(designOf(design)).map((check) => check.checked);
    assert.ok(!checked.includes('The input of earlier call 1 in example 1 of "todo.list"'));
  });
});
