import { defineScript, fail } from "../../../../bay/sdk.ts";
import { add, addRequestOf, nextIdOfRows, selectNextId, selectTodos, todosOfRows } from "./todo-rules.ts";

const keepNextId =
  'INSERT INTO "todo-ids" (slot, next_id) VALUES (1, ?) ON CONFLICT (slot) DO UPDATE SET next_id = excluded.next_id';

const insertTodo = 'INSERT INTO "todos" (id, text, status) VALUES (?, ?, ?)';

export const run = defineScript(async (input, context) => {
  const todoRows = await context.db.query(selectTodos);
  if (!todoRows.ok) {
    return fail(todoRows.message);
  }
  const nextIdRows = await context.db.query(selectNextId);
  if (!nextIdRows.ok) {
    return fail(nextIdRows.message);
  }
  const result = add({
    request: addRequestOf(input),
    todos: todosOfRows(todoRows.value),
    nextId: nextIdOfRows(nextIdRows.value),
  });
  if (result.kind === "refused") {
    return fail(result.reason);
  }
  const keptNextId = await context.db.execute(keepNextId, [result.nextId]);
  if (!keptNextId.ok) {
    return fail(keptNextId.message);
  }
  const inserted = await context.db.execute(insertTodo, [result.answer.id, result.answer.text, result.answer.status]);
  if (!inserted.ok) {
    return fail(inserted.message);
  }
  return result.answer;
});
