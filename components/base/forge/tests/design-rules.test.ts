import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { designOf } from "../scripts/lib/design-form.ts";
import { designProblems } from "../scripts/lib/design-rules.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { todoDesign } from "./todo-design.ts";

const file = "docs/requirements/todo.yaml";

const conditions = [
  ...["O1-C1", "O1-C2", "O1-C3", "O1-C4", "O1-C5", "O1-C6", "O1-C7"],
  ...["O2-C1", "O2-C2", "O2-C3", "O2-C4", "O2-C5", "O2-C6"],
];

type Changed = (design: Json) => Json;

function problemsOf(design: Json, job = "todo"): readonly string[] {
  return designProblems({ job, file, conditions, design: designOf(design) });
}

function listAt(value: Json, key: string): readonly Json[] {
  return listOf(fieldsOf(value)[key]);
}

function withModules(design: Json, modules: readonly Json[]): Json {
  return { ...fieldsOf(design), modules: [...modules] };
}

function withActions(design: Json, change: (actions: readonly Json[]) => readonly Json[]): Json {
  const [todo = null, ...others] = listAt(design, "interfaces");
  const changed = { ...fieldsOf(todo), actions: [...change(listAt(todo, "actions"))] };
  return { ...fieldsOf(design), interfaces: [changed, ...others] };
}

function actionChanged(name: string, change: (action: Json) => Json): Changed {
  return (design) =>
    withActions(design, (actions) =>
      actions.map((action) => (fieldsOf(action).name === name ? change(action) : action)),
    );
}

const store: Json = { name: "store", hides: "Where rows are written.", implements: [] };

describe("the design check, one rule at a time, each problem with its sentence", () => {
  test("the todo design breaks no rule", () => {
    assert.deepEqual(problemsOf(todoDesign), []);
  });

  test("a module with no interface", () => {
    const design = withModules(todoDesign, [...listAt(todoDesign, "modules"), store]);
    assert.deepEqual(problemsOf(design), [
      'The module "store" implements no interface; name in implements the interface it offers, or fold it into a module that has one.',
    ]);
  });

  test("a module that implements an interface the design does not define", () => {
    const design = withModules(todoDesign, [
      ...listAt(todoDesign, "modules"),
      { ...fieldsOf(store), implements: ["rows"] },
    ]);
    assert.deepEqual(problemsOf(design), [
      'The module "store" implements "rows", which the design does not define; define that interface or take it out of implements.',
    ]);
  });

  test("an interface no module implements", () => {
    const [todo = null] = listAt(todoDesign, "modules");
    const design = withModules(todoDesign, [{ ...fieldsOf(todo), implements: [] }]);
    assert.deepEqual(problemsOf(design), [
      'The module "todo" implements no interface; name in implements the interface it offers, or fold it into a module that has one.',
      'The interface "todo" is implemented by no module; add it to implements of the module that offers it.',
    ]);
  });

  test("a table and a file that two modules own", () => {
    const owner = (name: string): Json => ({
      name,
      hides: "Something.",
      implements: ["todo"],
      owns: { tables: ["todos"], files: [".todo/list.json"] },
    });
    assert.deepEqual(problemsOf(withModules(todoDesign, [owner("todo"), owner("report")])), [
      'The table "todos" is owned by the modules "todo" and "report"; let one module own it and the others ask that module.',
      'The file ".todo/list.json" is owned by the modules "todo" and "report"; let one module own it and the others ask that module.',
    ]);
  });

  test("a condition no action serves", () => {
    const design = actionChanged("add", (action) => ({
      ...fieldsOf(action),
      serves: ["O1-C1", "O1-C4", "O1-C5", "O1-C6", "O1-C7"],
    }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      `The condition O2-C4 of ${file} is served by no action; name it in serves of the action a person uses for it.`,
    ]);
  });

  test("an action that serves a condition the requirements do not have", () => {
    const design = actionChanged("remove", (action) => ({ ...fieldsOf(action), serves: ["O2-C3", "O2-C5", "O9-C1"] }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      `The action "todo.remove" serves O9-C1, which ${file} does not have; name only conditions the requirements hold.`,
    ]);
  });

  test("an action that serves no condition and gives no reason, and one that gives a reason", () => {
    const purge: Json = {
      name: "purge",
      request: {},
      response: {},
      serves: [],
      examples: [{ input: {}, answer: {} }],
    };
    const bare = withActions(todoDesign, (actions) => [...actions, purge]);
    assert.deepEqual(problemsOf(bare), [
      'The action "todo.purge" serves no condition and gives no reason in because; name the conditions it serves, or say in because why it exists, such as an operator\'s need.',
    ]);
    const reasoned = withActions(todoDesign, (actions) => [
      ...actions,
      { ...fieldsOf(purge), because: "An operator empties a list." },
    ]);
    assert.deepEqual(problemsOf(reasoned), []);
  });

  test("an action with no worked example", () => {
    const design = actionChanged("list", (action) => ({ ...fieldsOf(action), examples: [] }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      'The action "todo.list" has no worked example; give at least one: an input, and the exact answer or the exact refusal sentence.',
    ]);
  });

  test("an example that calls before an action its interface does not have", () => {
    const example: Json = { earlier: [{ action: "purge", input: {} }], input: {}, answer: { todos: [] } };
    const design = actionChanged("list", (action) => ({ ...fieldsOf(action), examples: [example] }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      'An example of "todo.list" calls "purge" before, which the interface "todo" does not have; name an action of the same interface.',
    ]);
  });

  test("a schema that refers into implementation code, outside the design, or to a file of no action", () => {
    const outside = { type: "object", properties: { id: { $ref: "../../components/modes/todo/scripts/add.ts" } } };
    const elsewhere = { $ref: "purge-request.json" };
    const design = actionChanged("done", (action) => ({ ...fieldsOf(action), request: outside, response: elsewhere }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      'The request schema of "todo.done" refers to "../../components/modes/todo/scripts/add.ts"; an interface file refers only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.',
      'The response schema of "todo.done" refers to "purge-request.json"; an interface file refers only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.',
    ]);
  });

  test("a schema file that would be written outside the design's folder", () => {
    const design = actionChanged("list", (action) => ({ ...fieldsOf(action), name: "../list" }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      "The design would write docs/designs/todo/schemas/todo/../list-request.json, which is outside docs/designs/todo/; name interfaces and actions with lower-case letters, digits and dashes only.",
      "The design would write docs/designs/todo/schemas/todo/../list-response.json, which is outside docs/designs/todo/; name interfaces and actions with lower-case letters, digits and dashes only.",
    ]);
  });

  test("a module and an interface named for no work they do", () => {
    const [todo = null] = listAt(todoDesign, "modules");
    const helpers = withModules(todoDesign, [{ ...fieldsOf(todo), name: "todo-helpers", implements: ["common"] }]);
    const [shape = null] = listAt(todoDesign, "interfaces");
    const design = { ...fieldsOf(helpers), interfaces: [{ ...fieldsOf(shape), name: "common" }] };
    assert.deepEqual(problemsOf(design), [
      'The module "todo-helpers" is not named for what it does; name it for its work (P-36), never utils, helpers, common or manager.',
      'The interface "common" is not named for what it does; name it for its work (P-36), never utils, helpers, common or manager.',
    ]);
  });

  test("names used twice, and every problem at once", () => {
    const [todo = null] = listAt(todoDesign, "modules");
    const twice = withModules(todoDesign, [todo, { ...fieldsOf(todo), owns: {} }]);
    const design = withActions(twice, (actions) => [...actions, actions[0] ?? null]);
    const noExample = actionChanged("list", (action) => ({ ...fieldsOf(action), examples: [] }));
    assert.deepEqual(problemsOf(noExample(design)), [
      'The design has two modules named "todo"; give each module a name of its own.',
      'The interface "todo" has two actions named "add"; give each action a name of its own.',
      'The action "todo.list" has no worked example; give at least one: an input, and the exact answer or the exact refusal sentence.',
    ]);
  });
});
