import { defineScript, type Json } from "../../../../bay/sdk.ts";
import { fieldsOf, numberOf, textOf } from "./lib/json.ts";
import { monthOf, roundedUsd } from "./lib/month.ts";
import { openPartition, rowsOf } from "./lib/partition.ts";
import { selectMonthSpend } from "./lib/statements.ts";

function capOf(settings: Readonly<Record<string, Json>>, source: string): number | null {
  const caps = fieldsOf(settings.monthlyUsd);
  return (Object.hasOwn(caps, source) ? numberOf(caps[source]) : undefined) ?? null;
}

export const run = defineScript(async (input, context) => {
  const source = textOf(fieldsOf(input).source) ?? "";
  const month = monthOf(context.now());
  const partition = await openPartition(context);
  const [row] = await rowsOf(partition, selectMonthSpend, { source, month });
  const spentUsd = roundedUsd(numberOf(row?.usd) ?? 0);
  const capUsd = capOf(context.settings, source);
  const remainingUsd = capUsd === null ? null : roundedUsd(capUsd - spentUsd);
  return { source, month, capUsd, spentUsd, remainingUsd };
});
