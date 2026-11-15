import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { Terminal } from "./command-context.ts";

export type TerminalStreams = {
  readonly input: Readable & { readonly isTTY?: boolean; readonly setRawMode?: (mode: boolean) => unknown };
  readonly output: Writable;
};

const enter = new Set(["\r", "\n"]);

const interrupt = "\u0003";

const erase = new Set(["\u007f", "\b"]);

async function ask(streams: TerminalStreams, question: string): Promise<string> {
  const lines = createInterface({ input: streams.input, output: streams.output, terminal: false });
  try {
    return await lines.question(question);
  } finally {
    lines.close();
  }
}

function askHidden(streams: TerminalStreams, question: string): Promise<string> {
  const { input, output } = streams;
  output.write(question);
  return new Promise((resolve) => {
    let typed = "";
    const finish = (value: string): void => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      for (const character of String(chunk)) {
        if (enter.has(character) || character === interrupt) {
          finish(character === interrupt ? "" : typed);
          return;
        }
        typed = erase.has(character) ? typed.slice(0, -1) : typed + character;
      }
    };
    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
  });
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
    askHidden: (question) => askHidden(streams, question),
    readAll: () => readAll(streams.input),
  };
}
