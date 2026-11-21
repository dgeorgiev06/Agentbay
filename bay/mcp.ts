import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Json } from "./contracts.ts";
import { loadKernel, type Kernel } from "./kernel.ts";
import { nodeKernelPorts } from "./node-ports.ts";
import { layoutOf } from "./layout.ts";
import { replyTo, type ToolServer } from "./mcp-server.ts";
import { failedWith, unplacedProblem, type Outcome } from "./outcome.ts";
import { toolDefinitions } from "./tool-definitions.ts";
import { callKernelTool } from "./tools.ts";
import { lastResortHandler } from "./last-resort.ts";

const kit = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

function projectOf(argv: readonly string[]): string {
  const index = argv.indexOf("--project");
  const given = index >= 0 ? argv[index + 1] : argv.find((argument) => argument.startsWith("--project="))?.slice(10);
  return resolve(process.cwd(), given ?? ".");
}

function refusalOfProblems(kernel: Outcome<Kernel>): Outcome<Json> {
  const problems = kernel.ok ? [] : kernel.problems.map((problem) => `${problem.file}: ${problem.message}`);
  return failedWith([unplacedProblem(`The project cannot be loaded, so no tool works: ${problems.join(" ")}`)]);
}

async function main(): Promise<void> {
  const environment = process.env;
  const kernel = await loadKernel({
    layout: layoutOf({ kit, project: projectOf(process.argv.slice(2)) }),
    ports: nodeKernelPorts(environment),
    environment,
    platform: process.platform,
  });
  if (!kernel.ok) {
    const lines = kernel.problems.map((problem) => `${problem.file}: ${problem.message}`);
    process.stderr.write(`agentbay: the project cannot be loaded:\n${lines.join("\n")}\n`);
  }
  const server: ToolServer = {
    definitions: toolDefinitions,
    call: (name: string, input: Json) =>
      kernel.ok ? callKernelTool(kernel.value, name, input) : Promise.resolve(refusalOfProblems(kernel)),
  };
  let queue = Promise.resolve();
  const lines = createInterface({ input: process.stdin, terminal: false });
  lines.on("line", (line) => {
    queue = queue
      .then(async () => {
        const reply = await replyTo(server, line);
        if (reply !== undefined) {
          process.stdout.write(`${reply}\n`);
        }
      })
      .catch((error: unknown) => {
        process.stderr.write(`internal error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 70;
      });
  });
  lines.on("close", () => {
    void queue.then(() => {
      if (kernel.ok) {
        kernel.value.close();
      }
    });
  });
}

process.on(
  "unhandledRejection",
  lastResortHandler("agentbay-mcp", {
    write: (text) => process.stderr.write(text),
    exit: (code) => process.exit(code),
  }),
);

main().catch((error: unknown) => {
  process.stderr.write(`internal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 70;
});
