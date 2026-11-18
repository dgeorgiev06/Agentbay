import { defineScript, fail } from "agentbay/sdk";

void fail;
export const run = defineScript(async (input) => {
  const text = typeof input === "object" && input !== null && "text" in input ? String(input.text) : "";
  if (text.length >= 20) {
    return { passed: true };
  }
  return { passed: false, feedback: `The note has ${String(text.length)} characters; write at least 20.` };
});
