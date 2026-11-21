import { errorLine } from "./answers.ts";
import type { Json } from "./contracts.ts";
import type { Kernel } from "./kernel.ts";
import type { Environment, KernelPorts } from "./node-ports.ts";
import { parseJson } from "./json.ts";
import type { Layout } from "./layout.ts";
import { failedWith, unplacedProblem, type Outcome, type Problem } from "./outcome.ts";

export type Terminal = {
  readonly isInteractive: () => boolean;
  readonly ask: (question: string) => Promise<string>;
  readonly readAll: () => Promise<string>;
};

export type CommandContext = {
  readonly kit: string;
  readonly workingDirectory: string;
  readonly ports: KernelPorts;
  readonly environment: Environment;
  readonly platform: string;
  readonly terminal: Terminal;
};

export type Invocation = {
  readonly context: CommandContext;
  readonly layout: Layout;
  readonly usage: string;
  readonly positionals: readonly string[];
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
};

export type JsonObject = { readonly [key: string]: Json };

export type ExitCode = 0 | 1 | 2;

export type CommandResult = {
  readonly exitCode: ExitCode;
  readonly json: JsonObject;
  readonly text: string;
};

export type Handler = (invocation: Invocation) => Promise<CommandResult>;

export function succeeded(json: JsonObject, text: string): CommandResult {
  return { exitCode: 0, json: { ok: true, ...json }, text };
}

function problemJson(problem: Problem): JsonObject {
  return {
    file: problem.file,
    path: problem.path,
    ...(problem.line === undefined ? {} : { line: problem.line }),
    message: problem.message,
    ...(problem.fix === undefined ? {} : { fix: problem.fix }),
  };
}

function problemLines(problems: readonly Problem[]): string {
  return problems
    .flatMap((problem) => {
      const place = problem.line === undefined ? problem.file : `${problem.file}:${String(problem.line)}`;
      const heading = place === "" ? problem.message : `${place}: ${problem.message}`;
      return problem.fix === undefined ? [heading] : [heading, `  fix: ${problem.fix}`];
    })
    .join("\n");
}

export function problemsResult(problems: readonly Problem[]): CommandResult {
  return { exitCode: 1, json: { ok: false, problems: problems.map(problemJson) }, text: problemLines(problems) };
}

export function refusedResult(message: string, fix?: string): CommandResult {
  return problemsResult([{ file: "", path: "", message, ...(fix === undefined ? {} : { fix }) }]);
}

export function usageResult(message: string, usage: string): CommandResult {
  return { exitCode: 2, json: { ok: false, usage: message }, text: `${message}\nusage: ${usage}` };
}

export async function withKernel(
  invocation: Invocation,
  body: (kernel: Kernel) => Promise<CommandResult>,
): Promise<CommandResult> {
  const { context } = invocation;
  const { loadKernel } = await import("./kernel.ts");
  const loaded = await loadKernel({
    layout: invocation.layout,
    ports: context.ports,
    environment: context.environment,
    platform: context.platform,
  });
  if (!loaded.ok) {
    return problemsResult(loaded.problems);
  }
  const kernel = loaded.value;
  try {
    return await body(kernel);
  } catch (error) {
    const reason = kernel.secrets.redact(`bay stopped at an unexpected error: ${errorLine(error)}`);
    return refusedResult(reason, "Fix the cause and run it again; a run it was advancing can be resumed.");
  } finally {
    kernel.close();
  }
}

export function jsonArgument(text: string | undefined, what: string): Outcome<Json> {
  if (text === undefined) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: parseJson(text) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failedWith([unplacedProblem(`The ${what} is not valid JSON: ${reason}.`)]);
  }
}
