import { defineScript, fail } from "../../../../bay/sdk.ts";
import { done, idRequestOf, selectTodos, todosOfRows } from "./todo-rules.ts";

const markDone = 'UPDATE "todos" SET status = ? WHERE id = ?';

export const run = defineScript(async (input, context) => {
  const todoRows = await context.db.query(selectTodos);
  if (!todoRows.ok) {
    return fail(todoRows.message);
  }
  const result = done({ request: idRequestOf(input), todos: todosOfRows(todoRows.value) });
  if (result.kind === "refused") {
    return fail(result.reason);
  }
  const marked = await context.db.execute(markDone, [result.answer.status, result.answer.id]);
  if (!marked.ok) {
    return fail(marked.message);
  }
  return result.answer;
});
