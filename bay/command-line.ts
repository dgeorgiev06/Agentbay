import { resolve } from "node:path";
import { layoutOf } from "./layout.ts";
import { errorLine } from "./answers.ts";
import {
  refusedResult,
  usageResult,
  type CommandContext,
  type CommandResult,
  type ExitCode,
  type Handler,
} from "./command-context.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome } from "./outcome.ts";

export type OptionSpec = {
  readonly name: string;
  readonly takesValue: boolean;
};

export type Command = {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly options: readonly OptionSpec[];
  readonly positionals: { readonly least: number; readonly most: number };
  readonly handler: Handler;
};

export type CommandLineOutput = {
  readonly exitCode: ExitCode;
  readonly output: string;
};

type Parsed = {
  readonly positionals: string[];
  readonly values: Map<string, string>;
  readonly flags: Set<string>;
};

type Located = { readonly command: string | undefined; readonly rest: readonly string[] };

const globalOptions: readonly OptionSpec[] = [
  { name: "project", takesValue: true },
  { name: "json", takesValue: false },
  { name: "help", takesValue: false },
];

const globalUsage = "[--project <folder>] [--json]";

function helpText(commands: readonly Command[]): string {
  const width = Math.max(...commands.map((command) => command.name.length));
  const lines = commands.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return [
    `usage: bay <command> ${globalUsage} ...`,
    "",
    "commands:",
    ...lines,
    "",
    "Every command takes --project <folder> (default: the current folder) and --json (print one JSON object).",
    "Run bay <command> --help for its usage. Exit codes: 0 done, 1 problems reported, 2 wrong command line.",
  ].join("\n");
}

function commandHelp(command: Command): string {
  return [`usage: bay ${command.usage} ${globalUsage}`, "", command.summary].join("\n");
}

function locateCommand(argv: readonly string[]): Located {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--project") {
      index += 1;
    } else if (!token.startsWith("--")) {
      return { command: token, rest: [...argv.slice(0, index), ...argv.slice(index + 1)] };
    }
  }
  return { command: undefined, rest: argv };
}

function addOption(parsed: Parsed, spec: OptionSpec, value: string | undefined): string | undefined {
  if (!spec.takesValue) {
    parsed.flags.add(spec.name);
    return value === undefined ? undefined : `The option --${spec.name} takes no value.`;
  }
  if (value === undefined) {
    return `The option --${spec.name} needs a value.`;
  }
  if (parsed.values.has(spec.name)) {
    return `The option --${spec.name} is given twice.`;
  }
  parsed.values.set(spec.name, value);
  return undefined;
}

type OptionRead = {
  readonly spec: OptionSpec;
  readonly value: string | undefined;
  readonly next: number;
};

function valueAfterOption(word: string | undefined, allowed: readonly OptionSpec[]): string | undefined {
  if (word === "--") {
    return undefined;
  }
  if (word === undefined || !word.startsWith("--")) {
    return word;
  }
  const [name] = word.slice(2).split("=");
  return allowed.some((option) => option.name === name) ? undefined : word;
}

function readOption(tokens: readonly string[], index: number, allowed: readonly OptionSpec[]): Outcome<OptionRead> {
  const [name = "", ...valueParts] = (tokens[index] ?? "").slice(2).split("=");
  const spec = allowed.find((option) => option.name === name);
  if (spec === undefined) {
    return failedWith([unplacedProblem(`The option --${name} is not an option of this command.`)]);
  }
  if (valueParts.length > 0) {
    return succeededWith({ spec, value: valueParts.join("="), next: index + 1 });
  }
  if (spec.takesValue) {
    return succeededWith({ spec, value: valueAfterOption(tokens[index + 1], allowed), next: index + 2 });
  }
  return succeededWith({ spec, value: undefined, next: index + 1 });
}

function parseTokens(tokens: readonly string[], allowed: readonly OptionSpec[]): Parsed | string {
  const parsed: Parsed = { positionals: [], values: new Map(), flags: new Set() };
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      parsed.positionals.push(...tokens.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      parsed.positionals.push(token);
      index += 1;
      continue;
    }
    const option = readOption(tokens, index, allowed);
    if (!option.ok) {
      return problemText(option.problems);
    }
    const problem = addOption(parsed, option.value.spec, option.value.value);
    if (problem !== undefined) {
      return problem;
    }
    index = option.value.next;
  }
  return parsed;
}

function positionalProblem(command: Command, count: number): string | undefined {
  const { least, most } = command.positionals;
  if (count >= least && count <= most) {
    return undefined;
  }
  return (
    `bay ${command.name} takes ${least === most ? String(least) : `${String(least)} to ${String(most)}`} ` +
    `arguments, but ${String(count)} were given.`
  );
}

function rendered(result: CommandResult, asJson: boolean): CommandLineOutput {
  return { exitCode: result.exitCode, output: asJson ? JSON.stringify(result.json) : result.text };
}

function usageOutput(message: string, usage: string, asJson: boolean): CommandLineOutput {
  return rendered(usageResult(message, usage), asJson);
}

function withoutCommand(commands: readonly Command[], located: Located, asJson: boolean): CommandLineOutput {
  if (located.command === undefined && located.rest.includes("--help")) {
    const help = helpText(commands);
    return { exitCode: 0, output: asJson ? JSON.stringify({ ok: true, help }) : help };
  }
  const message = located.command === undefined ? "No command was given." : `There is no command ${located.command}.`;
  return usageOutput(message, `bay <command> ${globalUsage}; bay --help lists the commands`, asJson);
}

function parsedFor(command: Command, rest: readonly string[], asJson: boolean): Parsed | CommandLineOutput {
  const parsed = parseTokens(rest, [...globalOptions, ...command.options]);
  if (typeof parsed === "string") {
    return usageOutput(parsed, command.usage, asJson);
  }
  if (parsed.flags.has("help")) {
    const help = commandHelp(command);
    return { exitCode: 0, output: asJson ? JSON.stringify({ ok: true, help }) : help };
  }
  const countProblem = positionalProblem(command, parsed.positionals.length);
  return countProblem === undefined ? parsed : usageOutput(countProblem, command.usage, asJson);
}

export async function runCommandLine(
  commands: readonly Command[],
  argv: readonly string[],
  context: CommandContext,
): Promise<CommandLineOutput> {
  const asJson = argv.includes("--json");
  const located = locateCommand(argv);
  const command = commands.find((entry) => entry.name === located.command);
  if (command === undefined) {
    return withoutCommand(commands, located, asJson);
  }
  const parsed = parsedFor(command, located.rest, asJson);
  if ("output" in parsed) {
    return parsed;
  }
  const project = resolve(context.workingDirectory, parsed.values.get("project") ?? ".");
  const layout = layoutOf({ kit: context.kit, project });
  const result = await command.handler({ context, layout, ...parsed }).catch(unexpectedResult);
  return rendered(result, asJson);
}

function unexpectedResult(error: unknown): CommandResult {
  return refusedResult(`bay stopped at an unexpected error: ${errorLine(error)}`, "Fix the cause and run it again.");
}
