import { fileURLToPath } from "node:url";
import { errorLine } from "./answers.ts";
import type { Handler } from "./command-context.ts";
import type { Command } from "./command-line.ts";
import { authCommand, importCommand } from "./commands/not-built.ts";

function loadFailure(file: string, kit: string, error: unknown): Error {
  const first = error instanceof Error ? (error.stack?.split("\n")[0] ?? "") : "";
  const path = first.startsWith("file://") ? fileURLToPath(first) : first;
  const place = path.startsWith(`${kit}/`) ? `${path.slice(kit.length + 1)}: ` : "";
  return new Error(`${file} does not load: ${place}${errorLine(error)}`);
}

function lazyCommand(about: Omit<Command, "handler">, load: () => Promise<Handler>): Command {
  const file = `bay/commands/${about.name}.ts`;
  const handler: Handler = async (invocation) => {
    const loaded = await load().catch((error: unknown) => {
      throw loadFailure(file, invocation.context.kit, error);
    });
    return loaded(invocation);
  };
  return { ...about, handler };
}

const checkCommand = lazyCommand(
  {
    name: "check",
    summary: "Check manifests, skills, workflows, imports and limits, and report every problem at once.",
    usage: "check",
    options: [],
    positionals: { least: 0, most: 0 },
  },
  () => import("./commands/check.ts").then((module) => module.runCheck),
);

const newCommand = lazyCommand(
  {
    name: "new",
    summary: "Write a new mode, action, skill, workflow or interface from its template.",
    usage: "new <mode|action|skill|workflow|interface> <name> [--mode <mode>] [--tier base|modes]",
    options: [
      { name: "mode", takesValue: true },
      { name: "tier", takesValue: true },
    ],
    positionals: { least: 2, most: 2 },
  },
  () => import("./commands/new.ts").then((module) => module.runNew),
);

const actionsCommand = lazyCommand(
  {
    name: "actions",
    summary:
      "List the active modes, or the actions of one mode with their descriptions, effects and input schemas; " +
      "--find keeps those that hold every given word.",
    usage: "actions [<mode>] [--find <words>]",
    options: [{ name: "find", takesValue: true }],
    positionals: { least: 0, most: 1 },
  },
  () => import("./commands/actions.ts").then((module) => module.runActions),
);

const callCommand = lazyCommand(
  {
    name: "call",
    summary:
      "Start an action or a workflow and print the run; or call a kernel tool, which needs a task token " +
      "unless it is actions.",
    usage: "call <mode.action> ['<json>'] | call --workflow <mode>:<path> ['<json>'] | call --tool <name> '<json>'",
    options: [
      { name: "workflow", takesValue: true },
      { name: "tool", takesValue: true },
    ],
    positionals: { least: 0, most: 2 },
  },
  () => import("./commands/call.ts").then((module) => module.runCall),
);

const submitCommand = lazyCommand(
  {
    name: "submit",
    summary: "Hand in the output of a waiting skill step, with the token of its task.",
    usage: "submit <json | @file | -> --token <token> [--tokens <n>] [--usd <x>]",
    options: [
      { name: "token", takesValue: true },
      { name: "tokens", takesValue: true },
      { name: "usd", takesValue: true },
    ],
    positionals: { least: 1, most: 1 },
  },
  () => import("./commands/submit.ts").then((module) => module.runSubmit),
);

const runsCommand = lazyCommand(
  {
    name: "runs",
    summary:
      "List the runs, newest first; or show one run with its steps and task; --events adds events, " +
      "--new-token replaces the token of every task, or with --step only of that step's task.",
    usage: "runs [<run> [--full] [--events] [--new-token [--step <step key>]]]",
    options: [
      { name: "new-token", takesValue: false },
      { name: "step", takesValue: true },
      { name: "full", takesValue: false },
      { name: "events", takesValue: false },
    ],
    positionals: { least: 0, most: 1 },
  },
  () => import("./commands/runs.ts").then((module) => module.runRuns),
);

const approveCommand = lazyCommand(
  {
    name: "approve",
    summary:
      "Approve or reject what a waiting approval shows, or take one of its choices, naming its hash; or, with " +
      "--trust, give or withdraw trust in a mode's list. From a terminal, or from chat if allowed.",
    usage:
      "approve <run> <stepKey> --hash <hash> [--reject | --choice <name>] " +
      '[--via terminal | --via chat --quote "<the owner\'s words>"]; ' +
      'approve --trust <mode> [--reject] [--via chat --hash <hash> --quote "<the owner\'s words>"]',
    options: [
      { name: "hash", takesValue: true },
      { name: "reject", takesValue: false },
      { name: "choice", takesValue: true },
      { name: "via", takesValue: true },
      { name: "quote", takesValue: true },
      { name: "trust", takesValue: true },
    ],
    positionals: { least: 0, most: 2 },
  },
  () => import("./commands/approve.ts").then((module) => module.runApprove),
);

const resumeCommand = lazyCommand(
  {
    name: "resume",
    summary:
      "Continue a run: --rerun runs an unfinished step, or a side-by-side foreach's failed items, again, " +
      "--extend raises a spent budget, --stop ends it, each from a terminal or from chat if allowed; --due wakes waits.",
    usage:
      "resume <run> [--rerun | --extend <measure>=<amount>[,...] | --stop] " +
      '[--via terminal | --via chat --quote "<the owner\'s words>"] | resume --due',
    options: [
      { name: "rerun", takesValue: false },
      { name: "due", takesValue: false },
      { name: "extend", takesValue: true },
      { name: "stop", takesValue: false },
      { name: "via", takesValue: true },
      { name: "quote", takesValue: true },
    ],
    positionals: { least: 0, most: 1 },
  },
  () => import("./commands/resume.ts").then((module) => module.runResume),
);

const buildCommand = lazyCommand(
  {
    name: "build",
    summary: "Write the adapter's agent files for every skill step; --clean removes what a build wrote.",
    usage: "build [--clean] [--adapter <name>]",
    options: [
      { name: "clean", takesValue: false },
      { name: "adapter", takesValue: true },
    ],
    positionals: { least: 0, most: 0 },
  },
  () => import("./commands/build.ts").then((module) => module.runBuild),
);

const secretCommand = lazyCommand(
  {
    name: "secret",
    summary: "Store a secret in the macOS keychain from an interactive terminal, or check that one can be found.",
    usage: "secret set <NAME> | secret check <NAME>",
    options: [],
    positionals: { least: 2, most: 2 },
  },
  () => import("./commands/secret.ts").then((module) => module.runSecret),
);

const configCommand = lazyCommand(
  {
    name: "config",
    summary: "Print every setting the project config may hold, with its current value, and which mode serves whom.",
    usage: "config",
    options: [],
    positionals: { least: 0, most: 0 },
  },
  () => import("./commands/config.ts").then((module) => module.runConfig),
);

export const commands: readonly Command[] = [
  checkCommand,
  newCommand,
  actionsCommand,
  callCommand,
  submitCommand,
  runsCommand,
  approveCommand,
  resumeCommand,
  buildCommand,
  secretCommand,
  authCommand,
  configCommand,
  importCommand,
];
