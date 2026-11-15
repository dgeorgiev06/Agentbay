import { measures } from "../runs/budget.ts";
import { problemsResult, usageResult, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Budget } from "../generated/mode.ts";
import type { Kernel } from "../kernel.ts";
import type { RunView } from "../runs/run-state.ts";
import type { Outcome } from "../outcome.ts";
import { engineOutput, skillWaitOf } from "../run-report.ts";

type Form =
  | { readonly kind: "due" }
  | { readonly kind: "resume"; readonly runId: string; readonly rerun: boolean }
  | { readonly kind: "extend"; readonly runId: string; readonly extra: Budget }
  | { readonly kind: "stop"; readonly runId: string };

const usage = "resume <run> [--rerun | --extend <measure>=<amount>[,...] | --stop] | resume --due";

function amountOf(entry: string): readonly [string, number] | string {
  const [measure = "", text = "", ...rest] = entry.split("=");
  if (!measures.some((known) => known === measure)) {
    return `--extend names the measure ${measure}; the measures are ${measures.join(", ")}.`;
  }
  const amount = Number(text);
  if (rest.length > 0 || text.trim() === "" || !Number.isFinite(amount) || amount < 0) {
    return `--extend gives ${measure} the amount ${text}; an amount is a number of at least 0.`;
  }
  return [measure, amount];
}

function extensionOf(text: string): Budget | string {
  const entries: [string, number][] = [];
  for (const entry of text.split(",")) {
    const parsed = amountOf(entry.trim());
    if (typeof parsed === "string") {
      return parsed;
    }
    entries.push([parsed[0], parsed[1]]);
  }
  return Object.fromEntries(entries);
}

function runFormOf(invocation: Invocation, runId: string): Form | string {
  const extend = invocation.values.get("extend");
  const stop = invocation.flags.has("stop");
  const rerun = invocation.flags.has("rerun");
  if ([extend !== undefined, stop, rerun].filter(Boolean).length > 1) {
    return "Give at most one of --rerun, --extend and --stop.";
  }
  if (stop) {
    return { kind: "stop", runId };
  }
  if (extend === undefined) {
    return { kind: "resume", runId, rerun };
  }
  const extra = extensionOf(extend);
  return typeof extra === "string" ? extra : { kind: "extend", runId, extra };
}

function formOf(invocation: Invocation): Form | string {
  const [runId] = invocation.positionals;
  const due = invocation.flags.has("due");
  if (!due) {
    return runId === undefined ? "Name the run to resume, or give --due." : runFormOf(invocation, runId);
  }
  const others = ["rerun", "stop"].some((flag) => invocation.flags.has(flag)) || invocation.values.has("extend");
  return runId !== undefined || others
    ? "--due wakes every due run and takes no run and no other option."
    : { kind: "due" };
}

async function resumeDue(kernel: Kernel): Promise<CommandResult> {
  const results = await kernel.engine.tick(kernel.ports.clock.now());
  const woken = results.flatMap((result) => (result.ok ? [result.value] : []));
  const problems = results.flatMap((result) => (result.ok ? [] : result.problems));
  if (problems.length > 0) {
    return problemsResult(problems);
  }
  const lines = woken.map((run) => `${run.id}: ${run.state.status}`);
  const json = { ok: true, woken: woken.map((run) => ({ id: run.id, status: run.state.status })) };
  return { exitCode: 0, json, text: lines.length === 0 ? "No run is due." : lines.join("\n") };
}

function engineCall(kernel: Kernel, form: Exclude<Form, { readonly kind: "due" }>): Promise<Outcome<RunView>> {
  switch (form.kind) {
    case "resume":
      return kernel.engine.resume(form.runId, { rerunUnfinished: form.rerun });
    case "extend":
      return kernel.engine.extendBudget(form.runId, form.extra);
    case "stop":
      return kernel.engine.stop(form.runId);
  }
}

function runResume(invocation: Invocation): Promise<CommandResult> {
  const form = formOf(invocation);
  if (typeof form === "string") {
    return Promise.resolve(usageResult(form, usage));
  }
  return withKernel(invocation, async (kernel) => {
    if (form.kind === "due") {
      return resumeDue(kernel);
    }
    const before = await skillWaitOf(kernel, form.runId);
    return engineOutput(kernel, await engineCall(kernel, form), (key) => (key === before ? "withhold" : "issue"));
  });
}

export const resumeCommand: Command = {
  name: "resume",
  summary:
    "Continue a run: --rerun runs an unfinished step again, --extend raises a spent budget, --stop ends it; " +
    "--due wakes waits.",
  usage,
  options: [
    { name: "rerun", takesValue: false },
    { name: "due", takesValue: false },
    { name: "extend", takesValue: true },
    { name: "stop", takesValue: false },
  ],
  positionals: { least: 0, most: 1 },
  handler: runResume,
};
