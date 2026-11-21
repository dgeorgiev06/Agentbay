import { sectionNamed, sectionNames } from "../approval-screen.ts";
import { refusedResult, succeeded, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Kernel } from "../kernel.ts";
import { runListJson, runLine, runResult } from "../run-report.ts";
import type { ReportOptions } from "../waiting-report.ts";

async function listRuns(kernel: Kernel): Promise<CommandResult> {
  const runs = await kernel.runs.list();
  const text = runs.length === 0 ? "No runs yet." : runs.map(runLine).join("\n");
  return succeeded({ runs: runs.map(runListJson) }, text);
}

function detailsOf(invocation: Invocation): ReportOptions["details"] | string {
  const named = invocation.values.get("section");
  if (named === undefined) {
    return invocation.flags.has("details") ? {} : undefined;
  }
  const section = sectionNamed(named);
  return section === undefined ? `The section ${named} is not one of ${sectionNames()}.` : { section };
}

async function showRun(kernel: Kernel, invocation: Invocation, runId: string): Promise<CommandResult> {
  const newToken = invocation.flags.has("new-token");
  const step = invocation.values.get("step");
  const details = detailsOf(invocation);
  if (typeof details === "string") {
    return refusedResult(details);
  }
  const shown = newToken ? await kernel.runs.reissueTask(runId, step) : await kernel.runs.show(runId);
  const flags = { steps: true, full: invocation.flags.has("full"), events: invocation.flags.has("events") };
  const options = details === undefined ? flags : { ...flags, details };
  return runResult(kernel.layout, shown, newToken ? { ...options, after: "reissue" } : options);
}

export function runRuns(invocation: Invocation): Promise<CommandResult> {
  const [runId] = invocation.positionals;
  return withKernel(invocation, (kernel) =>
    runId === undefined ? listRuns(kernel) : showRun(kernel, invocation, runId),
  );
}
