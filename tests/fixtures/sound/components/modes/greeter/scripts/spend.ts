import { defineScript, fail } from "agentbay/sdk";

export const run = defineScript(async (input, context) => {
  const spent = await context.spend({ tokens: 10 });
  return spent.ok ? input : fail(spent.message);
});
