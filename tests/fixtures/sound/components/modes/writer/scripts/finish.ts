import { defineScript, fail } from "agentbay/sdk";

export const run = defineScript(async (input, context) => {
  const text = typeof input === "object" && input !== null && "text" in input ? String(input.text) : "";
  const written = await context.files.write("out/notes/note.txt", text);
  if (!written.ok) {
    return fail(written.message);
  }
  return { text, saved: "out/notes/note.txt" };
});
