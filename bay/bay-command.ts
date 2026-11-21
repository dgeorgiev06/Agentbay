import type { Terminal } from "./command-context.ts";
import { runCommandLine, type CommandLineOutput } from "./command-line.ts";
import { commands } from "./commands.ts";
import { nodeKernelPorts, type Environment } from "./kernel.ts";

export type BayInvocation = {
  readonly kit: string;
  readonly workingDirectory: string;
  readonly environment: Environment;
  readonly terminal: Terminal;
};

export function bayCommand(argv: readonly string[], invocation: BayInvocation): Promise<CommandLineOutput> {
  return runCommandLine(commands, argv, {
    ...invocation,
    ports: nodeKernelPorts(invocation.environment),
    platform: process.platform,
  });
}
