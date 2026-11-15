import { defineScript, fail } from "../../../../bay/sdk.ts";
import { costOf, pageOf, settingsOf, sourceKinds, sourceName } from "./lib/feed.ts";

export const run = defineScript(async (input, context) => {
  const settings = settingsOf(context.settings);
  const page = pageOf(input, settings);
  const cost = costOf(page.posts.length, settings);
  const charged = await context.spend(cost);
  if (!charged.ok) {
    return fail(charged.message);
  }
  return { source: sourceName, kinds: sourceKinds, items: page.posts, cursor: page.cursor, more: page.more, cost };
});
