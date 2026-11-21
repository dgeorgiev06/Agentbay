import type { Json } from "../../../../bay/sdk.ts";

const todo: Json = {
  type: "object",
  additionalProperties: false,
  required: ["id", "text", "status"],
  properties: {
    id: { type: "integer", minimum: 1 },
    text: { type: "string", minLength: 1, maxLength: 500 },
    status: { enum: ["open", "done"] },
  },
};

const byId: Json = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
};

const added = (text: string): Json => ({ action: "add", input: { text } });

const stored: Json = {
  name: "todos",
  store: "todos",
  schema: { type: "array", items: { $ref: "schemas/todo/add-response.json" } },
};

function changing(name: string, action: string, decides: string): Json {
  const request = { name: "request", schema: { $ref: `schemas/todo/${action}-request.json` } };
  const answer = { name: "answer", schema: { $ref: `schemas/todo/${action}-response.json` } };
  return { name, decides, takes: [request, stored], gives: [stored, answer] };
}

const todoRules: Json = [
  changing("add-todo", "add", "Whether a text may be added, and the id the new todo gets."),
  changing("mark-done", "done", "Whether a todo may be marked done."),
  changing("remove-todo", "remove", "Whether a todo may be removed."),
];

const kept = { reads: ["todos"], writes: ["todos"] };

export const noTodo99 = "No todo has the id 99, so nothing is marked done or removed.";

export const alreadyDone = "Todo 1 is already done, so it is not marked again.";

export const todoHides = "How todos are kept, numbered and never given a removed id again.";

const todoSaid: Json = [
  { id: "P-32", sentence: "The mode has no skill step, so no step that needs no judgement is a skill." },
  { id: "P-35", sentence: "The one module names its interface todo before anything else." },
  { id: "P-52", sentence: "The rules of a todo are pure functions over the stored todos." },
];

export const todoDesign: Json = {
  practices: todoSaid,
  modules: [{ name: "todo", hides: todoHides, implements: ["todo"], owns: { tables: ["todos"] }, rules: todoRules }],
  interfaces: [
    {
      name: "todo",
      actions: [
        {
          name: "add",
          request: {
            type: "object",
            additionalProperties: false,
            required: ["text"],
            properties: { text: { type: "string", maxLength: 500 } },
          },
          response: todo,
          serves: ["O1-C1", "O1-C4", "O1-C5", "O1-C6", "O1-C7", "O2-C4"],
          rule: "add-todo",
          ...kept,
          examples: [
            { input: { text: "buy milk" }, answer: { id: 1, text: "buy milk", status: "open" } },
            {
              earlier: [added("buy milk")],
              input: { text: "" },
              refusal: "The text is empty; give the todo a text of 1 to 500 characters.",
            },
            {
              earlier: [added("buy milk"), added("call the bank"), { action: "remove", input: { id: 2 } }],
              input: { text: "post the letter" },
              answer: { id: 3, text: "post the letter", status: "open" },
            },
          ],
        },
        {
          name: "list",
          request: {
            type: "object",
            additionalProperties: false,
            properties: { status: { enum: ["open", "all"] } },
          },
          response: {
            type: "object",
            additionalProperties: false,
            required: ["todos"],
            properties: { todos: { type: "array", items: { $ref: "add-response.json" } } },
          },
          serves: ["O1-C1", "O1-C2", "O1-C3", "O2-C1", "O2-C2", "O2-C3"],
          reads: ["todos"],
          examples: [
            { input: {}, answer: { todos: [] } },
            {
              earlier: [added("buy milk"), added("call the bank")],
              input: { status: "open" },
              answer: {
                todos: [
                  { id: 1, text: "buy milk", status: "open" },
                  { id: 2, text: "call the bank", status: "open" },
                ],
              },
            },
          ],
        },
        {
          name: "done",
          request: byId,
          response: { $ref: "add-response.json" },
          serves: ["O2-C1", "O2-C2", "O2-C5", "O2-C6"],
          rule: "mark-done",
          ...kept,
          examples: [
            { earlier: [added("buy milk")], input: { id: 1 }, answer: { id: 1, text: "buy milk", status: "done" } },
            {
              earlier: [added("buy milk"), { action: "done", input: { id: 1 } }],
              input: { id: 1 },
              refusal: alreadyDone,
            },
            { earlier: [added("buy milk")], input: { id: 99 }, refusal: noTodo99 },
          ],
        },
        {
          name: "remove",
          request: byId,
          response: {
            type: "object",
            additionalProperties: false,
            required: ["removed"],
            properties: { removed: { type: "integer", minimum: 1 } },
          },
          serves: ["O2-C3", "O2-C4", "O2-C5"],
          rule: "remove-todo",
          ...kept,
          examples: [
            { earlier: [added("buy milk"), added("call the bank")], input: { id: 2 }, answer: { removed: 2 } },
            { earlier: [added("buy milk")], input: { id: 99 }, refusal: noTodo99 },
          ],
        },
      ],
    },
  ],
};
