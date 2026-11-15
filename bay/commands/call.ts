import {
  jsonArgument,
  problemsResult,
  succeeded,
  usageResult,
  withKernel,
  type CommandResult,
  type Invocation,
} from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Json } from "../contracts.ts";
import type { Kernel } from "../kernel.ts";
import { engineOutput } from "../run-report.ts";
import { callKernelTool } from "../tools.ts";
import { problemText } from "../outcome.ts";

type Form =
  | { readonly kind: "action"; readonly reference: string; readonly input: string | undefined }
  | { readonly kind: "workflow"; readonly mode: string; readonly path: string; readonly input: string | undefined }
  | { readonly kind: "tool"; readonly name: string; readonly input: string | undefined };

const usage = "call <mode.action> ['<json>'] | call --workflow <mode>:<path> ['<json>'] | call --tool <name> '<json>'";

function workflowForm(target: string, input: string | undefined): Form | string {
  const separator = target.indexOf(":");
  if (separator <= 0 || separator === target.length - 1) {
    return `--workflow takes <mode>:<path>, such as notes:workflows/daily.yaml, not ${target}.`;
  }
  return { kind: "workflow", mode: target.slice(0, separator), path: target.slice(separator + 1), input };
}

function formOf(invocation: Invocation): Form | string {
  const workflow = invocation.values.get("workflow");
  const tool = invocation.values.get("tool");
  const [first, second] = invocation.positionals;
  if (workflow !== undefined && tool !== undefined) {
    return "Give --workflow or --tool, not both.";
  }
  if (workflow !== undefined || tool !== undefined) {
    if (second !== undefined) {
      return "With --workflow or --tool, give only the JSON input.";
    }
    return tool === undefined ? workflowForm(workflow ?? "", first) : { kind: "tool", name: tool, input: first };
  }
  return first === undefined
    ? "Name the action to call as <mode>.<action>."
    : { kind: "action", reference: first, input: second };
}

async function callTool(kernel: Kernel, name: string, input: Json): Promise<CommandResult> {
  const result = await callKernelTool(kernel, name, input);
  if (!result.ok) {
    return problemsResult(result.problems);
  }
  return succeeded({ result: result.value }, JSON.stringify(result.value, null, 2));
}

async function callForm(kernel: Kernel, form: Form, input: Json): Promise<CommandResult> {
  switch (form.kind) {
    case "action":
      return engineOutput(
        kernel,
        await kernel.runs.agentTools.engine.startAction(form.reference, input),
        () => "issue",
      );
    case "workflow":
      return engineOutput(
        kernel,
        await kernel.runs.agentTools.engine.startWorkflow({ mode: form.mode, path: form.path }, input),
        () => "issue",
      );
    case "tool":
      return callTool(kernel, form.name, input);
  }
}

async function runCall(invocation: Invocation): Promise<CommandResult> {
  const form = formOf(invocation);
  if (typeof form === "string") {
    return usageResult(form, usage);
  }
  const input = jsonArgument(form.input, "input");
  if (!input.ok) {
    return usageResult(problemText(input.problems), usage);
  }
  return withKernel(invocation, (kernel) => callForm(kernel, form, input.value));
}

export const callCommand: Command = {
  name: "call",
  summary: "Start an action or a workflow and print the run; or call a kernel tool with a task token.",
  usage,
  options: [
    { name: "workflow", takesValue: true },
    { name: "tool", takesValue: true },
  ],
  positionals: { least: 0, most: 2 },
  handler: runCall,
};
