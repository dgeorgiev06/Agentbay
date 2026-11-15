import { defineScript, fail } from "../../../../bay/sdk.ts";
import { fieldsOf, textOf } from "./lib/json.ts";
import { openPartition } from "./lib/partition.ts";

export const run = defineScript(async (input, context) => {
  const sql = textOf(fieldsOf(input).sql) ?? "";
  const partition = await openPartition(context);
  const answer = await partition.agentQuery(sql);
  if (!answer.ok) {
    return fail(answer.message);
  }
  return { columns: answer.value.columns, rows: answer.value.rows };
});
