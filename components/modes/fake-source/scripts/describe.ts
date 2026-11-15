import { defineScript } from "../../../../bay/sdk.ts";
import { costOf, nativeFields, settingsOf, sourceKinds, sourceName } from "./lib/feed.ts";

export const run = defineScript((_input, context) => {
  const settings = settingsOf(context.settings);
  const pageCostUsd = costOf(settings.pageSize, settings).usd;
  return Promise.resolve({ source: sourceName, kinds: sourceKinds, nativeFields, pageCostUsd });
});
