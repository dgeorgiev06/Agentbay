import { defineScript, fail } from "../../../../bay/sdk.ts";
import { itemOf, itemOfRow, rowParameters } from "./lib/items.ts";
import { fieldsOf, textOf } from "./lib/json.ts";
import { changesOf, openPartition, rowsOf } from "./lib/partition.ts";
import { selectItemById, upsertItem } from "./lib/statements.ts";

export const run = defineScript(async (input, context) => {
  const request = fieldsOf(input);
  const id = textOf(request.id) ?? "";
  const partition = await openPartition(context);
  const [row] = await rowsOf(partition, selectItemById, { id });
  if (row === undefined) {
    return fail(`There is no item ${id} in the store to update.`);
  }
  const item = itemOf({ ...itemOfRow(row), ...fieldsOf(request.set) });
  await changesOf(partition, upsertItem, rowParameters(item, context.now().toISOString()));
  return { item };
});
