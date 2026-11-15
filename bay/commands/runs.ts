import { succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Kernel } from "../kernel.ts";
import { runListJson, runLine, runResult } from "../run-report.ts";

async function listRuns(kernel: Kernel): Promise<CommandResult> {
  const runs = await kernel.runs.list();
  const text = runs.length === 0 ? "No runs yet." : runs.map(runLine).join("\n");
  return succeeded({ runs: runs.map(runListJson) }, text);
}

async function showRun(kernel: Kernel, invocation: Invocation, runId: string): Promise<CommandResult> {
  const newToken = invocation.flags.has("new-token");
  const shown = newToken ? await kernel.runs.reissueTask(runId) : await kernel.runs.show(runId);
  const options = { steps: true, full: invocation.flags.has("full"), events: invocation.flags.has("events") };
  return runResult(kernel.layout, shown, newToken ? { ...options, after: "reissue" } : options);
}

function runRuns(invocation: Invocation): Promise<CommandResult> {
  const [runId] = invocation.positionals;
  return withKernel(invocation, (kernel) =>
    runId === undefined ? listRuns(kernel) : showRun(kernel, invocation, runId),
  );
}

export const runsCommand: Command = {
  name: "runs",
  summary:
    "List the runs, newest first; or show one run with its steps and task; --events adds events, " +
    "--new-token replaces the task's token.",
  usage: "runs [<run> [--full] [--events] [--new-token]]",
  options: [
    { name: "new-token", takesValue: false },
    { name: "full", takesValue: false },
    { name: "events", takesValue: false },
  ],
  positionals: { least: 0, most: 1 },
  handler: runRuns,
};
