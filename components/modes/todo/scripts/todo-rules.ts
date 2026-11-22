import { fieldsOf, type Json, type Row } from "../../../../bay/sdk.ts";

export type Todo = {
  readonly id: number;
  readonly text: string;
  readonly status: "open" | "done";
};

export type Refused = {
  readonly kind: "refused";
  readonly reason: string;
};

export type AddRequest = { readonly text: string };

export type AddTaken = {
  readonly request: AddRequest;
  readonly todos: readonly Todo[];
  readonly nextId: number | null;
};

export type AddResult =
  | Refused
  | {
      readonly kind: "added";
      readonly todos: readonly Todo[];
      readonly nextId: number;
      readonly answer: Todo;
    };

export type ListRequest = { readonly which: "open" | "all" };

export type ListTaken = {
  readonly request: ListRequest;
  readonly todos: readonly Todo[];
};

export type ListResult = {
  readonly answer: { readonly todos: readonly Todo[] };
};

export type IdRequest = { readonly id: number };

export type IdTaken = {
  readonly request: IdRequest;
  readonly todos: readonly Todo[];
};

export type ChangeResult =
  | Refused
  | {
      readonly kind: "changed";
      readonly todos: readonly Todo[];
      readonly answer: Todo;
    };

export const longestText = 500;

export const selectTodos = 'SELECT id, text, status FROM "todos" ORDER BY id LIMIT 100000';

export const selectNextId = 'SELECT next_id FROM "todo-ids" WHERE slot = 1 LIMIT 1';

const characterSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function charactersSeen(text: string): number {
  return Array.from(characterSegmenter.segment(text)).length;
}

function refused(reason: string): Refused {
  return { kind: "refused", reason };
}

function noTodoWithId(id: number): Refused {
  return refused(`No todo has the id ${String(id)}: list all todos to see the ids there are.`);
}

export function add(taken: AddTaken): AddResult {
  const text = taken.request.text.trim();
  if (text === "") {
    return refused("The text is empty: write what the todo is, and add it again.");
  }
  if (charactersSeen(text) > longestText) {
    return refused(`A todo's text may be at most ${String(longestText)} characters: shorten it and add it again.`);
  }
  const id = taken.nextId ?? 1;
  const answer: Todo = { id, text, status: "open" };
  return { kind: "added", todos: [...taken.todos, answer], nextId: id + 1, answer };
}

export function list(taken: ListTaken): ListResult {
  const shown = taken.request.which === "all" ? taken.todos : taken.todos.filter((todo) => todo.status === "open");
  return { answer: { todos: shown } };
}

export function done(taken: IdTaken): ChangeResult {
  const found = taken.todos.find((todo) => todo.id === taken.request.id);
  if (found === undefined) {
    return noTodoWithId(taken.request.id);
  }
  if (found.status === "done") {
    return refused(`Todo ${String(found.id)} is already done: list the open todos to see what is left to do.`);
  }
  const answer: Todo = { ...found, status: "done" };
  return {
    kind: "changed",
    todos: taken.todos.map((todo) => (todo.id === found.id ? answer : todo)),
    answer,
  };
}

export function remove(taken: IdTaken): ChangeResult {
  const found = taken.todos.find((todo) => todo.id === taken.request.id);
  if (found === undefined) {
    return noTodoWithId(taken.request.id);
  }
  return { kind: "changed", todos: taken.todos.filter((todo) => todo.id !== found.id), answer: found };
}

export function addRequestOf(input: Json): AddRequest {
  const text = fieldsOf(input).text;
  return { text: typeof text === "string" ? text : "" };
}

export function listRequestOf(input: Json): ListRequest {
  return { which: fieldsOf(input).which === "all" ? "all" : "open" };
}

export function idRequestOf(input: Json): IdRequest {
  const id = fieldsOf(input).id;
  return { id: typeof id === "number" ? id : 0 };
}

export function todosOfRows(rows: readonly Row[]): readonly Todo[] {
  return rows.flatMap((row) => {
    const { id, text, status } = row;
    if (typeof id === "number" && typeof text === "string" && (status === "open" || status === "done")) {
      return [{ id, text, status }];
    }
    return [];
  });
}

export function nextIdOfRows(rows: readonly Row[]): number | null {
  const next = rows[0]?.next_id;
  return typeof next === "number" ? next : null;
}
