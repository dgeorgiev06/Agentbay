import assert from "node:assert/strict";
import type { CommandContext, Terminal } from "../bay/command-context.ts";
import type { Json } from "../bay/contracts.ts";
import { toJson } from "../bay/json.ts";
import { runCommandLine, type CommandLineOutput } from "../bay/command-line.ts";
import { commands } from "../bay/commands.ts";
import { nodeKernelPorts, type KernelPorts } from "../bay/kernel.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

export type FakeTerminal = Terminal & { readonly asked: string[] };

export type TerminalScript = {
  readonly interactive?: boolean;
  readonly answer?: string;
  readonly input?: string;
};

export function fakeTerminal(script: TerminalScript = {}): FakeTerminal {
  const asked: string[] = [];
  return {
    asked,
    isInteractive: () => script.interactive ?? false,
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(script.answer ?? "");
    },
    readAll: () => Promise.resolve(script.input ?? ""),
  };
}

export type ContextChanges = {
  readonly terminal?: Terminal;
  readonly ports?: Partial<KernelPorts>;
  readonly platform?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly kit?: string;
  readonly workingDirectory?: string;
};

export function contextFor(changes: ContextChanges = {}): CommandContext {
  const environment = { ...testEnvironment, ...changes.environment };
  return {
    kit: changes.kit ?? kit,
    workingDirectory: changes.workingDirectory ?? "/",
    ports: { ...nodeKernelPorts(environment), ...changes.ports },
    environment,
    platform: changes.platform ?? "linux",
    terminal: changes.terminal ?? fakeTerminal(),
  };
}

export type Ran = CommandLineOutput & { readonly json: unknown };

export async function bay(argv: readonly string[], changes: ContextChanges = {}): Promise<Ran> {
  const output = await runCommandLine(commands, argv, contextFor(changes));
  let json: unknown;
  if (argv.includes("--json")) {
    json = JSON.parse(output.output);
  }
  return { ...output, json };
}

export function listOf(value: Json | undefined): readonly Json[] {
  assert.ok(Array.isArray(value), `expected a list, got ${JSON.stringify(value)}`);
  return value.map((element: unknown) => toJson(element));
}
