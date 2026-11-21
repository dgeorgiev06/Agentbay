import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { listOf } from "../scripts/lib/json-values.ts";

const longest: Json = { $text: [{ repeat: "a", times: 500 }] };

const tooLong: Json = { $text: [{ repeat: "a", times: 501 }] };

const notAscii: Json = {
  $text: [
    { repeat: "ü", times: 250 },
    { repeat: "🥛", times: 250 },
  ],
};

const empty = "The text is empty; write the todo in a few words and add it again.";

const noTodo99 = "No todo has the id 99; list all todos to see their ids, then try again with one of them.";

const byId: Json = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
};

const todoShape: Json = {
  type: "object",
  additionalProperties: false,
  required: ["id", "text", "status"],
  properties: {
    id: { type: "integer", minimum: 1 },
    text: { type: "string", minLength: 1, maxLength: 500, pattern: "\\S" },
    status: { enum: ["open", "done"] },
  },
};

const oneTodo: Json = { $ref: "list-response.json#/$defs/todo" };

const added = (text: Json): Json => ({ action: "add", input: { text } });

const called = (action: string, id: number): Json => ({ action, input: { id } });

const open = (id: number, text: Json): Json => ({ id, text, status: "open" });

const request = (action: string): Json => ({
  name: "request",
  schema: { $ref: `schemas/todo/${action}-request.json` },
});

const answer = (action: string): Json => ({ name: "answer", schema: { $ref: `schemas/todo/${action}-response.json` } });

const todos: Json = {
  name: "todos",
  store: "todos",
  schema: { type: "array", items: { $ref: "schemas/todo/list-response.json#/$defs/todo" } },
};

const nextId: Json = { name: "next-id", store: "todo-ids", schema: { type: "integer", minimum: 1 } };

const addRule: Json = {
  name: "add",
  decides:
    "Whether a text may be added, its length counted in Unicode code points, and the id the new todo gets, " +
    "which is the next id, raised by one so that no id is given twice.",
  takes: [request("add"), todos, nextId],
  gives: [todos, nextId, answer("add")],
};

const rules: Json = [
  addRule,
  {
    name: "list-todos",
    decides: "Which todos a list shows: the open ones, or all, in the order they were added.",
    takes: [request("list"), todos],
    gives: [answer("list")],
  },
  {
    name: "mark-done",
    decides: "Whether a todo may be marked done: it exists and is still open.",
    takes: [request("done"), todos],
    gives: [todos, answer("done")],
  },
  {
    name: "remove-todo",
    decides: "Whether a todo may be removed: it exists; its id is never given again, since the next id stays.",
    takes: [request("remove"), todos],
    gives: [todos, answer("remove")],
  },
];

const hides =
  "How todos are kept and numbered, the tables todos and todo-ids read and written in one transaction so that a " +
  "second call waits for the first.";

const practices: Json = [
  {
    id: "P-52",
    sentence:
      "Each action of todo applies one rule of the module todo, add taking the stored todos and the next id and " +
      "giving the new todos, the new next id and the answer or the refusal, and its thin function reads before " +
      "and writes after only what the rule takes and gives.",
  },
  { id: "P-32", sentence: "No step of add, list, done or remove needs judgement, so the design has no skill." },
  { id: "P-35", sentence: "The one module todo names its one entry, the interface todo, before anything else." },
];

const addAction: Json = {
  name: "add",
  request: {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  },
  response: oneTodo,
  serves: ["O1-C1", "O1-C4", "O1-C5", "O1-C6", "O1-C7", "O2-C4"],
  rule: "add",
  reads: ["todos", "todo-ids"],
  writes: ["todos", "todo-ids"],
  examples: [
    { input: { text: "buy milk" }, answer: open(1, "buy milk") },
    { input: { text: longest }, answer: open(1, longest) },
    { input: { text: notAscii }, answer: open(1, notAscii) },
    { earlier: [added("buy milk")], input: { text: "" }, refusal: empty },
    { earlier: [added("buy milk")], input: { text: "   " }, refusal: empty },
    {
      earlier: [added("buy milk")],
      input: { text: tooLong },
      refusal: "The text has 501 characters, and a todo holds at most 500; shorten it and add it again.",
    },
    {
      earlier: [added("buy milk"), added("call the bank"), called("remove", 2)],
      input: { text: "post the letter" },
      answer: open(3, "post the letter"),
    },
  ],
};

const listAction: Json = {
  name: "list",
  request: {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: { status: { enum: ["open", "all"] } },
  },
  response: {
    type: "object",
    additionalProperties: false,
    required: ["todos"],
    properties: { todos: { type: "array", items: { $ref: "#/$defs/todo" } } },
    $defs: { todo: todoShape },
  },
  serves: ["O1-C1", "O1-C2", "O1-C3", "O1-C4", "O2-C1", "O2-C2", "O2-C3"],
  rule: "list-todos",
  reads: ["todos"],
  writes: [],
  examples: [
    { input: { status: "open" }, answer: { todos: [] } },
    {
      earlier: [added("buy milk"), added("call the bank")],
      input: { status: "open" },
      answer: { todos: [open(1, "buy milk"), open(2, "call the bank")] },
    },
    { earlier: [added(longest)], input: { status: "open" }, answer: { todos: [open(1, longest)] } },
    {
      earlier: [added("buy milk"), added(""), added("   "), added(tooLong)],
      input: { status: "open" },
      answer: { todos: [open(1, "buy milk")] },
    },
    {
      earlier: [added("buy milk"), added("call the bank"), called("done", 1)],
      input: { status: "all" },
      answer: { todos: [{ id: 1, text: "buy milk", status: "done" }, open(2, "call the bank")] },
    },
    {
      earlier: [added("buy milk"), added("call the bank"), called("remove", 2)],
      input: { status: "all" },
      answer: { todos: [open(1, "buy milk")] },
    },
  ],
};

const doneAction: Json = {
  name: "done",
  request: byId,
  response: oneTodo,
  serves: ["O2-C1", "O2-C2", "O2-C5", "O2-C6"],
  rule: "mark-done",
  reads: ["todos"],
  writes: ["todos"],
  examples: [
    {
      earlier: [added("buy milk"), added("call the bank")],
      input: { id: 1 },
      answer: { id: 1, text: "buy milk", status: "done" },
    },
    { earlier: [added("buy milk")], input: { id: 99 }, refusal: noTodo99 },
    {
      earlier: [added("buy milk"), called("done", 1)],
      input: { id: 1 },
      refusal: "Todo 1 is already done; list the open todos to pick one still to do.",
    },
  ],
};

const removeAction: Json = {
  name: "remove",
  request: byId,
  response: oneTodo,
  serves: ["O2-C3", "O2-C4", "O2-C5"],
  rule: "remove-todo",
  reads: ["todos"],
  writes: ["todos"],
  examples: [
    {
      earlier: [added("buy milk"), added("call the bank")],
      input: { id: 2 },
      answer: open(2, "call the bank"),
    },
    { earlier: [added("buy milk")], input: { id: 99 }, refusal: noTodo99 },
  ],
};

export const answeredTodo: Json = {
  practices,
  modules: [{ name: "todo", hides, implements: ["todo"], owns: { tables: ["todos", "todo-ids"] }, rules }],
  interfaces: [{ name: "todo", actions: [addAction, listAction, doneAction, removeAction] }],
};

function withAddRule(design: Json, rule: Json): Json {
  const [module = null] = listOf(fieldsOf(design).modules);
  const kept = listOf(fieldsOf(module).rules).map((each) => (fieldsOf(each).name === "add" ? rule : each));
  return { ...fieldsOf(design), modules: [{ ...fieldsOf(module), rules: kept }] };
}

export const nextIdNotGiven: Json = withAddRule(answeredTodo, {
  ...fieldsOf(addRule),
  gives: [todos, answer("add")],
});
