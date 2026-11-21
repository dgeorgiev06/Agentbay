import {
  problemsResult,
  refusedResult,
  usageResult,
  withKernel,
  type CommandResult,
  type Invocation,
} from "../command-context.ts";
import type { Command } from "../command-line.ts";
import { measures } from "../contracts.ts";
import type { Budget } from "../generated/mode.ts";
import type { Kernel } from "../kernel.ts";
import type { Outcome } from "../outcome.ts";
import { byOf, channelOf, offRefusal, terminalRefusal, type Channel, type OwnerWords } from "../owner-source.ts";
import { runResult } from "../run-report.ts";
import { waitsOf, type Run } from "../runs/runs.ts";

type Answer =
  { readonly kind: "rerun" } | { readonly kind: "extend"; readonly extra: Budget } | { readonly kind: "stop" };

type Answering = {
  readonly kind: "answer";
  readonly runId: string;
  readonly answer: Answer;
  readonly channel: Channel;
};

type Form = { readonly kind: "due" } | { readonly kind: "resume"; readonly runId: string } | Answering;

const usage =
  "resume <run> [--rerun | --extend <measure>=<amount>[,...] | --stop] " +
  '[--via terminal | --via chat --quote "<the owner\'s words>"] | resume --due';

const sourceOptions = ["via", "quote"];

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

function answerOf(invocation: Invocation): Answer | string | undefined {
  const extend = invocation.values.get("extend");
  const stop = invocation.flags.has("stop");
  const rerun = invocation.flags.has("rerun");
  if ([extend !== undefined, stop, rerun].filter(Boolean).length > 1) {
    return "Give at most one of --rerun, --extend and --stop.";
  }
  if (extend !== undefined) {
    const extra = extensionOf(extend);
    return typeof extra === "string" ? extra : { kind: "extend", extra };
  }
  return stop ? { kind: "stop" } : rerun ? { kind: "rerun" } : undefined;
}

function runFormOf(invocation: Invocation, runId: string): Form | string {
  const answer = answerOf(invocation);
  if (typeof answer === "string") {
    return answer;
  }
  if (answer === undefined) {
    return sourceOptions.some((name) => invocation.values.has(name))
      ? "--via and --quote go with --rerun, --extend or --stop; a plain resume decides nothing for the owner."
      : { kind: "resume", runId };
  }
  const channel = channelOf(invocation);
  return typeof channel === "string" ? channel : { kind: "answer", runId, answer, channel };
}

function formOf(invocation: Invocation): Form | string {
  const [runId] = invocation.positionals;
  const due = invocation.flags.has("due");
  if (!due) {
    return runId === undefined ? "Name the run to resume, or give --due." : runFormOf(invocation, runId);
  }
  const values = ["extend", ...sourceOptions].some((name) => invocation.values.has(name));
  const others = ["rerun", "stop"].some((flag) => invocation.flags.has(flag)) || values;
  return runId !== undefined || others
    ? "--due wakes every due run and takes no run and no other option."
    : { kind: "due" };
}

async function resumeDue(kernel: Kernel): Promise<CommandResult> {
  const results = await kernel.runs.wakeDue();
  const woken = results.flatMap((result) => (result.ok ? [result.value] : []));
  const problems = results.flatMap((result) => (result.ok ? [] : result.problems));
  if (problems.length > 0) {
    return problemsResult(problems);
  }
  const lines = woken.map((run) => `${run.id}: ${run.state.status}`);
  const json = { ok: true, woken: woken.map((run) => ({ id: run.id, status: run.state.status })) };
  return { exitCode: 0, json, text: lines.length === 0 ? "No run is due." : lines.join("\n") };
}

function ownerWords(answer: Answer): OwnerWords {
  return { command: `bay resume --${answer.kind}`, answers: "Reruns, stops and budget extensions", verb: "Resume" };
}

function answerWords(form: Answering): string {
  switch (form.answer.kind) {
    case "rerun":
      return `You run run ${form.runId} again from where it stopped.`;
    case "extend":
      return `You raise the budget of run ${form.runId} by ${JSON.stringify(form.answer.extra)}.`;
    case "stop":
      return `You stop run ${form.runId}.`;
  }
}

function ownerQuestions(shown: Outcome<Run>): readonly string[] {
  const waits = shown.ok ? waitsOf(shown.value.state) : [];
  return waits.flatMap((waiting) => (waiting.reason === "owner" ? [waiting.question] : []));
}

async function confirmQuestion(kernel: Kernel, form: Answering): Promise<string> {
  const asked = ownerQuestions(await kernel.runs.show(form.runId));
  return [...asked, `${answerWords(form)} Type yes to confirm: `].join("\n");
}

async function sourceRefusal(
  invocation: Invocation,
  kernel: Kernel,
  form: Answering,
): Promise<CommandResult | undefined> {
  const words = ownerWords(form.answer);
  const off = offRefusal(kernel, form.channel, words);
  if (off !== undefined || form.channel.via === "chat") {
    return off;
  }
  const refusal = await terminalRefusal(invocation, words, await confirmQuestion(kernel, form));
  return refusal === undefined ? undefined : refusedResult(refusal);
}

function answered(kernel: Kernel, form: Answering): Promise<Outcome<Run>> {
  const by = byOf(form.channel);
  switch (form.answer.kind) {
    case "rerun":
      return kernel.runs.rerun(form.runId, by);
    case "extend":
      return kernel.runs.extend(form.runId, form.answer.extra, by);
    case "stop":
      return kernel.runs.stop(form.runId, by);
  }
}

async function resumeAnswering(invocation: Invocation, kernel: Kernel, form: Answering): Promise<CommandResult> {
  const refused = await sourceRefusal(invocation, kernel, form);
  return refused ?? runResult(kernel.layout, await answered(kernel, form));
}

async function resumeOne(invocation: Invocation, kernel: Kernel, form: Exclude<Form, { readonly kind: "due" }>) {
  return form.kind === "resume"
    ? runResult(kernel.layout, await kernel.runs.resume(form.runId))
    : resumeAnswering(invocation, kernel, form);
}

function runResume(invocation: Invocation): Promise<CommandResult> {
  const form = formOf(invocation);
  if (typeof form === "string") {
    return Promise.resolve(usageResult(form, usage));
  }
  return withKernel(invocation, (kernel) =>
    form.kind === "due" ? resumeDue(kernel) : resumeOne(invocation, kernel, form),
  );
}

export const resumeCommand: Command = {
  name: "resume",
  summary:
    "Continue a run: --rerun runs an unfinished step, or a side-by-side foreach's failed items, again, " +
    "--extend raises a spent budget, --stop ends it, each from a terminal or from chat if allowed; --due wakes waits.",
  usage,
  options: [
    { name: "rerun", takesValue: false },
    { name: "due", takesValue: false },
    { name: "extend", takesValue: true },
    { name: "stop", takesValue: false },
    { name: "via", takesValue: true },
    { name: "quote", takesValue: true },
  ],
  positionals: { least: 0, most: 1 },
  handler: runResume,
};
