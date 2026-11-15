import { defineScript } from "../../../../bay/sdk.ts";
import { itemOfRow } from "./lib/items.ts";
import { fieldsOf, textsOf } from "./lib/json.ts";
import { openPartition, rowsOf } from "./lib/partition.ts";
import { selectItemsByIds } from "./lib/statements.ts";

export const run = defineScript(async (input, context) => {
  const ids = textsOf(fieldsOf(input).ids);
  const partition = await openPartition(context);
  const rows = await rowsOf(partition, selectItemsByIds, { ids: JSON.stringify(ids) });
  const found = new Map(rows.map((row) => itemOfRow(row)).map((item) => [item.id, item]));
  return {
    items: ids.flatMap((id) => found.get(id) ?? []),
    missing: ids.filter((id) => !found.has(id)),
  };
});
