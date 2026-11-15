import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Terminal } from "./command-context.ts";

export type TerminalStreams = {
  readonly input: Readable & { readonly isTTY?: boolean };
  readonly output: Writable;
};

async function ask(streams: TerminalStreams, question: string): Promise<string> {
  const lines = createInterface({ input: streams.input, output: streams.output, terminal: false });
  try {
    return await lines.question(question);
  } finally {
    lines.close();
  }
}

async function readAll(input: Readable): Promise<string> {
  const chunks: string[] = [];
  input.setEncoding("utf8");
  for await (const chunk of input) {
    chunks.push(String(chunk));
  }
  return chunks.join("");
}

export function streamTerminal(streams: TerminalStreams): Terminal {
  return {
    isInteractive: () => streams.input.isTTY === true,
    ask: (question) => ask(streams, question),
    readAll: () => readAll(streams.input),
  };
}
