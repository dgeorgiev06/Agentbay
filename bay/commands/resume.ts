import { problemsResult, usageResult, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Kernel } from "../kernel.ts";
import { engineOutput } from "../run-report.ts";

const usage = "resume <run> [--rerun] | resume --due";

async function resumeDue(kernel: Kernel): Promise<CommandResult> {
  const results = await kernel.engine.tick(kernel.ports.clock.now());
  const woken = results.flatMap((result) => (result.ok ? [result.run] : []));
  const problems = results.flatMap((result) => (result.ok ? [] : result.problems));
  if (problems.length > 0) {
    return problemsResult(problems);
  }
  const lines = woken.map((run) => `${run.id}: ${run.state.status}`);
  const json = { ok: true, woken: woken.map((run) => ({ id: run.id, status: run.state.status })) };
  return { exitCode: 0, json, text: lines.length === 0 ? "No run is due." : lines.join("\n") };
}

function runResume(invocation: Invocation): Promise<CommandResult> {
  const [runId] = invocation.positionals;
  const due = invocation.flags.has("due");
  if (due === (runId !== undefined) || (due && invocation.flags.has("rerun"))) {
    return Promise.resolve(usageResult("Name one run to resume, or give --due alone.", usage));
  }
  return withKernel(invocation, async (kernel) => {
    if (runId === undefined) {
      return resumeDue(kernel);
    }
    const result = await kernel.engine.resume(runId, { rerunUnfinished: invocation.flags.has("rerun") });
    return engineOutput(kernel, result);
  });
}

export const resumeCommand: Command = {
  name: "resume",
  summary: "Continue a run from its last finished step; --rerun runs an unfinished step again; --due wakes waits.",
  usage,
  options: [
    { name: "rerun", takesValue: false },
    { name: "due", takesValue: false },
  ],
  positionals: { least: 0, most: 1 },
  handler: runResume,
};
