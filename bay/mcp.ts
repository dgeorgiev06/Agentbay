import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Json } from "./contracts.ts";
import { loadKernel, nodeKernelPorts, type Kernel } from "./kernel.ts";
import { replyTo, type ToolServer } from "./mcp-server.ts";
import type { Outcome } from "./spec.ts";
import { toolDefinitions } from "./tool-definitions.ts";
import { callKernelTool, type ToolResult } from "./tools.ts";

const kit = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

function projectOf(argv: readonly string[]): string {
  const index = argv.indexOf("--project");
  const given = index >= 0 ? argv[index + 1] : argv.find((argument) => argument.startsWith("--project="))?.slice(10);
  return resolve(process.cwd(), given ?? ".");
}

function refusalOfProblems(kernel: Outcome<Kernel>): ToolResult {
  const problems = kernel.ok ? [] : kernel.problems.map((problem) => `${problem.file}: ${problem.message}`);
  return { ok: false, refusal: `The project cannot be loaded, so no tool works: ${problems.join(" ")}` };
}

async function main(): Promise<void> {
  const environment = process.env;
  const kernel = await loadKernel({
    project: projectOf(process.argv.slice(2)),
    kit,
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

main().catch((error: unknown) => {
  process.stderr.write(`internal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 70;
});
