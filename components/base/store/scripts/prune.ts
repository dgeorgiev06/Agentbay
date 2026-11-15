import { defineScript } from "../../../../bay/sdk.ts";
import { millisecondsOf } from "./lib/items.ts";
import { fieldsOf, textOf } from "./lib/json.ts";
import { changesOf, countOf, openPartition } from "./lib/partition.ts";
import { countItems, pruneItems } from "./lib/statements.ts";

export const run = defineScript(async (input, context) => {
  const before = millisecondsOf(textOf(fieldsOf(input).before) ?? "") ?? 0;
  const partition = await openPartition(context);
  const removed = await changesOf(partition, pruneItems, { before });
  return { removed, remaining: await countOf(partition, countItems) };
});
