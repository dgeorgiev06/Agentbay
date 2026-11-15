import { fileURLToPath } from "node:url";
import { runCommandLine } from "./command-line.ts";
import { commands } from "./commands.ts";
import { nodeKernelPorts } from "./kernel.ts";
import { streamTerminal } from "./terminal.ts";

const kit = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

async function main(): Promise<void> {
  const environment = process.env;
  const result = await runCommandLine(commands, process.argv.slice(2), {
    kit,
    workingDirectory: process.cwd(),
    ports: nodeKernelPorts(environment),
    environment,
    platform: process.platform,
    terminal: streamTerminal({ input: process.stdin, output: process.stderr }),
  });
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`internal error: ${message.split("\n")[0] ?? ""}\n`);
  process.exitCode = 70;
});
