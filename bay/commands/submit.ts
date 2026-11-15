import { resolve } from "node:path";
import { jsonArgument, usageResult, withKernel, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Json, Spend } from "../contracts.ts";
import { runResult } from "../run-report.ts";
import { failedWith, problemText, unplacedProblem, type Outcome } from "../outcome.ts";

const usage = "submit <json | @file | -> --token <token> [--tokens <n>] [--usd <x>]";

function amountOf(invocation: Invocation, name: string): number | string {
  const text = invocation.values.get(name);
  if (text === undefined) {
    return 0;
  }
  const amount = Number(text);
  return text.trim() !== "" && Number.isFinite(amount) && amount >= 0
    ? amount
    : `--${name} takes a number of at least 0.`;
}

function spentOf(invocation: Invocation): Spend | string {
  const tokens = amountOf(invocation, "tokens");
  const usd = amountOf(invocation, "usd");
  if (typeof tokens === "string" || typeof usd === "string") {
    return typeof tokens === "string" ? tokens : String(usd);
  }
  return { items: 0, usd, tokens, minutes: 0 };
}

async function outputText(invocation: Invocation, source: string): Promise<string | undefined> {
  const { context } = invocation;
  if (source === "-") {
    return context.terminal.readAll();
  }
  if (source.startsWith("@")) {
    return context.ports.files.readText(resolve(context.workingDirectory, source.slice(1)));
  }
  return source;
}

async function outputOf(invocation: Invocation, source: string): Promise<Outcome<Json>> {
  const text = await outputText(invocation, source);
  if (text === undefined) {
    return failedWith([unplacedProblem(`The file ${source.slice(1)} does not exist.`)]);
  }
  return jsonArgument(text, "output");
}

async function runSubmit(invocation: Invocation): Promise<CommandResult> {
  const [source = ""] = invocation.positionals;
  const token = invocation.values.get("token");
  if (token === undefined) {
    return usageResult("submit needs --token: the token the task carries.", usage);
  }
  const spent = spentOf(invocation);
  const output = await outputOf(invocation, source);
  if (typeof spent === "string") {
    return usageResult(spent, usage);
  }
  if (!output.ok) {
    return usageResult(problemText(output.problems), usage);
  }
  const submission = { output: output.value, spent };
  return withKernel(invocation, async (kernel) =>
    runResult(kernel.layout, await kernel.runs.submit(token, submission), { after: "submit" }),
  );
}

export const submitCommand: Command = {
  name: "submit",
  summary: "Hand in the output of a waiting skill step, with the token of its task.",
  usage,
  options: [
    { name: "token", takesValue: true },
    { name: "tokens", takesValue: true },
    { name: "usd", takesValue: true },
  ],
  positionals: { least: 1, most: 1 },
  handler: runSubmit,
};
