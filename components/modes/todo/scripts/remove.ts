import { defineScript, fail } from "../../../../bay/sdk.ts";
import { idRequestOf, remove, selectTodos, todosOfRows } from "./todo-rules.ts";

const deleteTodo = 'DELETE FROM "todos" WHERE id = ?';

export const run = defineScript(async (input, context) => {
  const todoRows = await context.db.query(selectTodos);
  if (!todoRows.ok) {
    return fail(todoRows.message);
  }
  const result = remove({ request: idRequestOf(input), todos: todosOfRows(todoRows.value) });
  if (result.kind === "refused") {
    return fail(result.reason);
  }
  const deleted = await context.db.execute(deleteTodo, [result.answer.id]);
  if (!deleted.ok) {
    return fail(deleted.message);
  }
  return result.answer;
});
