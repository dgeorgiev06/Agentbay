import { differencesBetween } from "./lib/differences.ts";
import { commitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

export const run = defineRequestScript(async (request, context) => {
  const from = await commitOf(context, ".", request.text("from"));
  const to = await commitOf(context, ".", request.text("to"));
  return { paths: await differencesBetween(context, { from, to }) };
});
