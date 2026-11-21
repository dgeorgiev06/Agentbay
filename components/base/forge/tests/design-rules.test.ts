import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { exampleChecks, examplesChecked, selfContained, type FitAnswer } from "../scripts/lib/design-examples.ts";
import { designOf, type Interface } from "../scripts/lib/design-form.ts";
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
    const [todo = null] = listAt(todoDesign, "modules");
    const owner = (name: string): Json => ({
      ...fieldsOf(todo),
      name,
      owns: { tables: ["todos"], files: [".todo/list.json"] },
      rules: name === "todo" ? (fieldsOf(todo).rules ?? []) : [],
    });
    const listed = actionChanged("list", (action) => ({ ...fieldsOf(action), reads: ["todos", ".todo/list.json"] }));
    assert.deepEqual(problemsOf(listed(withModules(todoDesign, [owner("todo"), owner("report")]))), [
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

  test("a reference outside the interface inside a list or two levels down is refused, naming its side", () => {
    const request = { oneOf: [{ type: "object" }, { $ref: "../list/list-request.json" }] };
    const response = {
      type: "object",
      properties: { todos: { type: "array", items: { properties: { id: { $ref: "scripts/ids.ts" } } } } },
    };
    const design = actionChanged("done", (action) => ({ ...fieldsOf(action), request, response }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      'The request schema of "todo.done" refers to "../list/list-request.json"; an interface file refers only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.',
      'The response schema of "todo.done" refers to "scripts/ids.ts"; an interface file refers only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.',
    ]);
  });

  test("a reference under $defs or additionalProperties is held by the rule, and a part of itself inside a list is accepted", () => {
    const inside = {
      $defs: { id: { type: "integer" } },
      anyOf: [{ $ref: "#/$defs/id" }, { prefixItems: [{ $ref: "add-response.json" }] }],
    };
    const accepted = actionChanged("done", (action) => ({ ...fieldsOf(action), request: inside }));
    assert.deepEqual(problemsOf(accepted(todoDesign)), []);
    const request = { $defs: { id: { $ref: "/abs/id.json" } } };
    const response = { type: "object", additionalProperties: { $ref: "https://example.invalid/todo.json" } };
    const design = actionChanged("done", (action) => ({ ...fieldsOf(action), request, response }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      'The request schema of "todo.done" refers to "/abs/id.json"; an interface file refers only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.',
      'The response schema of "todo.done" refers to "https://example.invalid/todo.json"; an interface file refers only to a part of itself (#/...) or to another schema file of its interface, such as add-request.json.',
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
    assert.deepEqual(
      problemsOf(design).filter((problem) => problem.includes("(P-36)")),
      [
        'The module "todo-helpers" is not named for what it does; name it for its work (P-36), never utils, helpers, common or manager.',
        'The interface "common" is not named for what it does; name it for its work (P-36), never utils, helpers, common or manager.',
      ],
    );
  });

  test("names used twice, and every problem at once", () => {
    const [todo = null] = listAt(todoDesign, "modules");
    const twice = withModules(todoDesign, [todo, { ...fieldsOf(todo), owns: {}, rules: [] }]);
    const design = withActions(twice, (actions) => [...actions, actions[0] ?? null]);
    const noExample = actionChanged("list", (action) => ({ ...fieldsOf(action), examples: [] }));
    assert.deepEqual(problemsOf(noExample(design)), [
      'The design has two modules named "todo"; give each module a name of its own.',
      'The interface "todo" has two actions named "add"; give each action a name of its own.',
      'The action "todo.list" has no worked example; give at least one: an input, and the exact answer or the exact refusal sentence.',
    ]);
  });
});

function checksOf(design: Json): readonly string[] {
  return exampleChecks(designOf(design)).map(
    (check) => `${check.checked}: the ${check.against.side} schema of ${check.against.action}`,
  );
}

function todoInterface(): Interface {
  const [todo] = designOf(todoDesign).interfaces;
  assert.ok(todo !== undefined);
  return todo;
}

describe("the worked examples, each held to its action's schemas", () => {
  test("the todo design's examples need 25 checks: each input and answer of an example that answers, and each earlier call", () => {
    assert.deepEqual(checksOf(todoDesign), [
      'The input of example 1 of "todo.add": the request schema of todo.add',
      'The answer of example 1 of "todo.add": the response schema of todo.add',
      'The input of earlier call 1 in example 2 of "todo.add": the request schema of todo.add',
      'The input of earlier call 1 in example 3 of "todo.add": the request schema of todo.add',
      'The input of earlier call 2 in example 3 of "todo.add": the request schema of todo.add',
      'The input of earlier call 3 in example 3 of "todo.add": the request schema of todo.remove',
      'The input of example 3 of "todo.add": the request schema of todo.add',
      'The answer of example 3 of "todo.add": the response schema of todo.add',
      'The input of example 1 of "todo.list": the request schema of todo.list',
      'The answer of example 1 of "todo.list": the response schema of todo.list',
      'The input of earlier call 1 in example 2 of "todo.list": the request schema of todo.add',
      'The input of earlier call 2 in example 2 of "todo.list": the request schema of todo.add',
      'The input of example 2 of "todo.list": the request schema of todo.list',
      'The answer of example 2 of "todo.list": the response schema of todo.list',
      'The input of earlier call 1 in example 1 of "todo.done": the request schema of todo.add',
      'The input of example 1 of "todo.done": the request schema of todo.done',
      'The answer of example 1 of "todo.done": the response schema of todo.done',
      'The input of earlier call 1 in example 2 of "todo.done": the request schema of todo.add',
      'The input of earlier call 2 in example 2 of "todo.done": the request schema of todo.done',
      'The input of earlier call 1 in example 3 of "todo.done": the request schema of todo.add',
      'The input of earlier call 1 in example 1 of "todo.remove": the request schema of todo.add',
      'The input of earlier call 2 in example 1 of "todo.remove": the request schema of todo.add',
      'The input of example 1 of "todo.remove": the request schema of todo.remove',
      'The answer of example 1 of "todo.remove": the response schema of todo.remove',
      'The input of earlier call 1 in example 2 of "todo.remove": the request schema of todo.add',
    ]);
  });

  test("a refusal's input is not checked, since the design does not say whether the schema refuses it; its earlier calls are", () => {
    const example: Json = {
      earlier: [{ action: "add", input: { text: 7 } }],
      input: { text: 7 },
      refusal: "The text is not text.",
    };
    const design = actionChanged("add", (action) => ({ ...fieldsOf(action), examples: [example] }));
    assert.deepEqual(checksOf(design(todoDesign)).slice(0, 1), [
      'The input of earlier call 1 in example 1 of "todo.add": the request schema of todo.add',
    ]);
    assert.equal(checksOf(design(todoDesign)).filter((check) => check.includes('example 1 of "todo.add"')).length, 1);
  });

  test("a schema that names another file of its interface is checked with that file's schema in its $defs", () => {
    const todo = todoInterface();
    const [add, list, done] = todo.actions;
    assert.ok(add !== undefined && list !== undefined && done !== undefined);
    assert.deepEqual(selfContained(todo, done, "response"), {
      $ref: "#/$defs/add-response.json",
      $defs: { "add-response.json": add.response },
    });
    assert.deepEqual(selfContained(todo, list, "response"), {
      type: "object",
      additionalProperties: false,
      required: ["todos"],
      properties: { todos: { type: "array", items: { $ref: "#/$defs/add-response.json" } } },
      $defs: { "add-response.json": add.response },
    });
    assert.deepEqual(selfContained(todo, add, "request"), add.request);
  });

  test("files named in turn are all taken in, a file's own references move with it, and a name of its own file is #", () => {
    const shelf = designOf({
      modules: [],
      interfaces: [
        {
          name: "shelf",
          actions: [
            {
              name: "put",
              request: {
                type: "object",
                properties: {
                  book: { $ref: "take-response.json#/$defs/book" },
                  again: { $ref: "put-request.json#/properties/book" },
                },
              },
              response: { type: "null" },
            },
            {
              name: "take",
              request: {},
              response: {
                $defs: { book: { $ref: "#/$defs/title" }, title: { type: "string" } },
                $ref: "put-response.json",
              },
            },
          ],
        },
      ],
    }).interfaces[0];
    const put = shelf?.actions[0];
    assert.ok(shelf !== undefined && put !== undefined);
    assert.deepEqual(selfContained(shelf, put, "request"), {
      type: "object",
      properties: {
        book: { $ref: "#/$defs/take-response.json/$defs/book" },
        again: { $ref: "#/properties/book" },
      },
      $defs: {
        "take-response.json": {
          $defs: { book: { $ref: "#/$defs/take-response.json/$defs/title" }, title: { type: "string" } },
          $ref: "#/$defs/put-response.json",
        },
        "put-response.json": { type: "null" },
      },
    });
  });

  test("each problem names the example, its side, the path and what the schema wanted; a refused schema is said once", () => {
    const [input, answer, earlier, otherEarlier] = exampleChecks(designOf(todoDesign)).slice(0, 4);
    assert.ok(input !== undefined && answer !== undefined && earlier !== undefined && otherEarlier !== undefined);
    const misfit: FitAnswer = {
      ok: true,
      value: { passed: false, problems: [{ path: "/text", message: "text must be text, but it is 7." }] },
    };
    const missing: FitAnswer = {
      ok: true,
      value: {
        passed: false,
        problems: [{ path: "", message: "The value is missing the required field id.", fix: "Add id." }],
      },
    };
    const refused: FitAnswer = { ok: false, message: "The schema given refers to x.json at /$ref, outside itself." };
    assert.deepEqual(
      examplesChecked([
        { check: input, answer: misfit },
        { check: answer, answer: missing },
        { check: earlier, answer: refused },
        { check: otherEarlier, answer: refused },
      ]),
      {
        problems: [
          'The input of example 1 of "todo.add" does not fit the request schema of "todo.add". At /text: text must be text, but it is 7.',
          'The answer of example 1 of "todo.add" does not fit the response schema of "todo.add". At its top: The value is missing the required field id. Add id.',
          'The request schema of "todo.add" could not be used, so no example was checked against it. The schema given refers to x.json at /$ref, outside itself.',
        ],
        refusedSchemas: 1,
      },
    );
    assert.deepEqual(examplesChecked([{ check: input, answer: { ok: true, value: { passed: true } } }]), {
      problems: [],
      refusedSchemas: 0,
    });
  });

  test("a refusal whose sentence is only spaces", () => {
    const example: Json = { input: { id: 99 }, refusal: "   " };
    const design = actionChanged("remove", (action) => ({ ...fieldsOf(action), examples: [example] }));
    assert.deepEqual(problemsOf(design(todoDesign)), [
      'Example 1 of "todo.remove" ends in a refusal with no words; write the exact sentence the refusal gives.',
    ]);
  });
});
