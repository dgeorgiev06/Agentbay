import { refusedResult, type CommandResult, type Invocation, type Terminal } from "./command-context.ts";
import type { Kernel } from "./kernel.ts";

export type Channel = { readonly via: "terminal" } | { readonly via: "chat"; readonly quote: string };

export type OwnerWords = {
  readonly command: string;
  readonly answers: string;
  readonly verb: string;
};

export const notConfirmed = "Not confirmed; nothing changed.";

export function channelOf(invocation: Invocation): Channel | string {
  const via = invocation.values.get("via") ?? "terminal";
  const quote = invocation.values.get("quote")?.trim();
  switch (via) {
    case "terminal":
      return quote === undefined ? { via } : "--quote goes with --via chat; at a terminal the owner types yes instead.";
    case "chat":
      return quote === undefined || quote === ""
        ? '--via chat needs --quote "<the owner\'s exact words>".'
        : { via, quote };
    default:
      return `--via is terminal or chat, not ${via}.`;
  }
}

export function allowedChannels(kernel: Kernel): readonly string[] {
  return kernel.system.config.approvals?.from ?? ["terminal"];
}

export function byOf(channel: Channel): string {
  return channel.via === "terminal"
    ? "owner at the terminal"
    : `owner via chat, quoted: ${JSON.stringify(channel.quote)}`;
}

export function offRefusal(kernel: Kernel, channel: Channel, words: OwnerWords): CommandResult | undefined {
  const allowed = allowedChannels(kernel);
  return allowed.includes(channel.via)
    ? undefined
    : refusedResult(
        `${words.answers} from ${channel.via} are off: approvals.from in agentbay.config.yaml lists ${allowed.join(", ")}.`,
        `${words.verb} from ${allowed.join(" or ")}; only the owner changes approvals.from.`,
      );
}

export async function typedYes(terminal: Terminal, question: string): Promise<boolean> {
  const answer = await terminal.ask(question);
  return answer.trim().toLowerCase() === "yes";
}

export async function terminalRefusal(
  invocation: Invocation,
  words: OwnerWords,
  question: string,
): Promise<string | undefined> {
  const terminal = invocation.context.terminal;
  if (!terminal.isInteractive()) {
    return (
      `${words.command} needs an interactive terminal (stdin is not a TTY). ${words.answers} are for the owner, ` +
      "not for agents: run it yourself in a terminal, or, if the project config lists chat under approvals.from, " +
      "use --via chat --quote."
    );
  }
  const confirmed = await typedYes(terminal, question);
  return confirmed ? undefined : notConfirmed;
}
