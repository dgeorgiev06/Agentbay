import { problemsResult, succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import { loadAdapter, planAgents } from "../build.ts";
import type { Kernel } from "../kernel.ts";
import type { Outcome } from "../spec.ts";

async function built(invocation: Invocation, kernel: Kernel): Promise<Outcome<readonly string[]>> {
  const { files, removal } = kernel.ports;
  const name = invocation.values.get("adapter") ?? kernel.system.config.adapter;
  const { layout } = kernel;
  const adapter = await loadAdapter(files, layout.kit, name);
  if (!adapter.ok) {
    return adapter;
  }
  if (invocation.flags.has("clean")) {
    return adapter.value.clean({ layout, files, removal });
  }
  const agents = await planAgents({ system: kernel.system, policyOf: kernel.policyOf, files });
  if (!agents.ok) {
    return agents;
  }
  return adapter.value.build({
    system: kernel.system,
    layout,
    agents: agents.value,
    removal,
    files,
  });
}

function runBuild(invocation: Invocation): Promise<CommandResult> {
  return withKernel(invocation, async (kernel) => {
    const outcome = await built(invocation, kernel);
    if (!outcome.ok) {
      return problemsResult(outcome.problems);
    }
    const verb = invocation.flags.has("clean") ? "removed or restored" : "wrote";
    const lines = outcome.value.length === 0 ? [`Nothing to report: the adapter ${verb} nothing.`] : outcome.value;
    return succeeded({ paths: [...outcome.value] }, lines.join("\n"));
  });
}

export const buildCommand: Command = {
  name: "build",
  summary: "Write the adapter's agent files for every skill step; --clean removes what a build wrote.",
  usage: "build [--clean] [--adapter <name>]",
  options: [
    { name: "clean", takesValue: false },
    { name: "adapter", takesValue: true },
  ],
  positionals: { least: 0, most: 0 },
  handler: runBuild,
};
