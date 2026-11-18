import { defineScript, fail } from "agentbay/sdk";

void fail;
export const run = defineScript(async (input) => {
  const name = typeof input === "object" && input !== null && "name" in input ? String(input.name) : "";
  return { greeting: `Hello, ${name}` };
});
