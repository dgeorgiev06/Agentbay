import { resolve } from "node:path";
import {
  jsonArgument,
  refusedResult,
  usageResult,
  withKernel,
  type CommandResult,
  type Invocation,
  type JsonArgument,
} from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Spend } from "../contracts.ts";
import { engineOutput } from "../run-report.ts";
import { checkTaskTokenFor } from "../task-tokens.ts";

const usage = "submit <run> <stepKey> <json | @file | -> --token <token> [--tokens <n>] [--usd <x>]";

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

async function outputOf(invocation: Invocation, source: string): Promise<JsonArgument> {
  const text = await outputText(invocation, source);
  if (text === undefined) {
    return { ok: false, message: `The file ${source.slice(1)} does not exist.` };
  }
  return jsonArgument(text, "output");
}

async function runSubmit(invocation: Invocation): Promise<CommandResult> {
  const [runId = "", stepKey = "", source = ""] = invocation.positionals;
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
    return usageResult(output.message, usage);
  }
  return withKernel(invocation, async (kernel) => {
    const checked = await checkTaskTokenFor({ tokens: kernel.store, runs: kernel.store }, token, { runId, stepKey });
    if (!checked.ok) {
      return refusedResult(checked.reason);
    }
    const result = await kernel.engine.submit(runId, stepKey, { output: output.value, spent });
    return engineOutput(kernel, result, stepKey);
  });
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
  positionals: { least: 3, most: 3 },
  handler: runSubmit,
};
