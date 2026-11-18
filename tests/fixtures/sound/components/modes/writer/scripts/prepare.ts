import { defineScript, fail } from "agentbay/sdk";

export const run = defineScript(async (input, context) => {
  const name = typeof input === "object" && input !== null && "name" in input ? String(input.name) : "";
  const answer = await context.call("greeting-source.fetch", { name });
  if (!answer.ok) {
    return fail(answer.message);
  }
  return { name, greeting: answer.value };
});
