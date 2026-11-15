import { defineScript, type Json } from "../../../../bay/sdk.ts";
import { numberOf, parsedJson, textOf, textsOf, type Fields } from "./lib/json.ts";
import { countOf, openPartition, rowsOf } from "./lib/partition.ts";
import { countDeletions, countItems, selectSources, selectSpend } from "./lib/statements.ts";

function spentOf(spend: readonly Fields[], source: string): Json {
  return spend
    .filter((row) => row.source === source)
    .map((row) => ({ month: textOf(row.month) ?? "", items: numberOf(row.items) ?? 0, usd: numberOf(row.usd) ?? 0 }));
}

function sourceOf(row: Fields, spend: readonly Fields[]): Json {
  const source = textOf(row.source) ?? "";
  const selector = textOf(row.selector);
  return {
    source,
    kinds: textsOf(parsedJson(textOf(row.kinds) ?? "[]")),
    items: numberOf(row.items) ?? 0,
    cursor: textOf(row.cursor) ?? null,
    lastSync: textOf(row.last_sync) ?? null,
    selector: selector === undefined ? null : (parsedJson(selector) ?? null),
    spent: spentOf(spend, source),
  };
}

export const run = defineScript(async (_input, context) => {
  const partition = await openPartition(context);
  const spend = await rowsOf(partition, selectSpend, {});
  const sources = await rowsOf(partition, selectSources, {});
  return {
    items: await countOf(partition, countItems),
    deletions: await countOf(partition, countDeletions),
    sources: sources.map((row) => sourceOf(row, spend)),
  };
});
