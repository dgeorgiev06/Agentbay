import { defineScript, fail } from "../../../../bay/sdk.ts";
import { list, listRequestOf, selectTodos, todosOfRows } from "./todo-rules.ts";

export const run = defineScript(async (input, context) => {
  const todoRows = await context.db.query(selectTodos);
  if (!todoRows.ok) {
    return fail(todoRows.message);
  }
  const result = list({ request: listRequestOf(input), todos: todosOfRows(todoRows.value) });
  return result.answer;
});
