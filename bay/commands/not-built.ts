import type { CommandResult } from "../command-context.ts";
import type { Command } from "../command-line.ts";

function notBuilt(slice: string): () => Promise<CommandResult> {
  const message = `not built yet (comes with the ${slice} slice)`;
  return () => Promise.resolve({ exitCode: 1, json: { ok: false, message }, text: message });
}

export const authCommand: Command = {
  name: "auth",
  summary: "Log in to a source that needs a browser login (not built yet).",
  usage: "auth <mode>",
  options: [],
  positionals: { least: 0, most: 1 },
  handler: notBuilt("M2"),
};

export const importCommand: Command = {
  name: "import-v4",
  summary: "Copy your own to-dos and other local items from an agentbay 4 store once (not built yet).",
  usage: "import-v4 <folder>",
  options: [],
  positionals: { least: 0, most: 1 },
  handler: notBuilt("M4"),
};
