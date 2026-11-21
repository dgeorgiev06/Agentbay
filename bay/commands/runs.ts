import { succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Kernel } from "../kernel.ts";
import { runListJson, runLine, runResult } from "../run-report.ts";

async function listRuns(kernel: Kernel): Promise<CommandResult> {
  const runs = await kernel.runs.list();
  const text = runs.length === 0 ? "No runs yet." : runs.map(runLine).join("\n");
  return succeeded({ runs: runs.map(runListJson) }, text);
}

async function showRun(kernel: Kernel, invocation: Invocation, runId: string): Promise<CommandResult> {
  const newToken = invocation.flags.has("new-token");
  const step = invocation.values.get("step");
  const shown = newToken ? await kernel.runs.reissueTask(runId, step) : await kernel.runs.show(runId);
  const options = { steps: true, full: invocation.flags.has("full"), events: invocation.flags.has("events") };
  return runResult(kernel.layout, shown, newToken ? { ...options, after: "reissue" } : options);
}

export function runRuns(invocation: Invocation): Promise<CommandResult> {
  const [runId] = invocation.positionals;
  return withKernel(invocation, (kernel) =>
    runId === undefined ? listRuns(kernel) : showRun(kernel, invocation, runId),
  );
}
