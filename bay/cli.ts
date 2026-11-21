import { fileURLToPath } from "node:url";
import { bayCommand } from "./bay-command.ts";
import { streamTerminal } from "./terminal.ts";
import { lastResortHandler } from "./last-resort.ts";

const kit = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

async function main(): Promise<void> {
  const result = await bayCommand(process.argv.slice(2), {
    kit,
    workingDirectory: process.cwd(),
    environment: process.env,
    terminal: streamTerminal({ input: process.stdin, output: process.stderr }),
  });
  process.stdout.write(`${result.output}\n`);
  process.exitCode = result.exitCode;
}

process.on(
  "unhandledRejection",
  lastResortHandler("bay", {
    write: (text) => process.stderr.write(text),
    exit: (code) => process.exit(code),
  }),
);

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`internal error: ${message.split("\n")[0] ?? ""}\n`);
  process.exitCode = 70;
});
