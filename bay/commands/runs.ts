import { succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Kernel } from "../kernel.ts";
import { runListJson, runLine, runOutput } from "../run-report.ts";
import { runStatuses, type StoredRun } from "../runs/run-store.ts";

async function allRuns(kernel: Kernel): Promise<readonly StoredRun[]> {
  const runs: StoredRun[] = [];
  for (const status of runStatuses) {
    runs.push(...(await kernel.store.listRuns(status)));
  }
  return runs.sort(
    (first, second) => second.createdAt.localeCompare(first.createdAt) || second.id.localeCompare(first.id),
  );
}

async function listRuns(kernel: Kernel): Promise<CommandResult> {
  const runs = await allRuns(kernel);
  const text = runs.length === 0 ? "No runs yet." : runs.map(runLine).join("\n");
  return succeeded({ runs: runs.map(runListJson) }, text);
}

function runRuns(invocation: Invocation): Promise<CommandResult> {
  const [runId] = invocation.positionals;
  return withKernel(invocation, (kernel) => {
    if (runId === undefined) {
      return listRuns(kernel);
    }
    const options = {
      steps: true,
      full: invocation.flags.has("full"),
      events: invocation.flags.has("events"),
      token: invocation.flags.has("new-token") ? ("replace" as const) : ("withhold" as const),
    };
    return runOutput(kernel, runId, options);
  });
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
