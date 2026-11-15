import { defineScript } from "../../../../bay/sdk.ts";
import { localSource } from "./lib/items.ts";
import { fieldsOf, textsOf } from "./lib/json.ts";
import { changesOf, openPartition } from "./lib/partition.ts";
import { deleteItem, rememberDeletion } from "./lib/statements.ts";

export const run = defineScript(async (input, context) => {
  const ids = textsOf(fieldsOf(input).ids);
  const partition = await openPartition(context);
  const deleted: string[] = [];
  const missing: string[] = [];
  const remembered: string[] = [];
  for (const id of ids) {
    const removed = await changesOf(partition, deleteItem, { id });
    (removed > 0 ? deleted : missing).push(id);
    if (!id.startsWith(`${localSource}:`)) {
      await changesOf(partition, rememberDeletion, { id, deleted_at: new Date().toISOString() });
      remembered.push(id);
    }
  }
  return { deleted, missing, remembered };
});
