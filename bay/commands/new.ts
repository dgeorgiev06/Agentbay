import { usageResult, problemsResult, succeeded, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import {
  newAction,
  newInterface,
  newMode,
  newSkill,
  newWorkflow,
  type Generated,
  type ModeTier,
  type Workspace,
} from "../new.ts";

type Generator = (workspace: Workspace, invocation: Invocation, name: string) => Promise<Generated> | string;

const usage = "new <mode|action|skill|workflow|interface> <name> [--mode <mode>] [--tier base|modes]";

function tierOf(invocation: Invocation): ModeTier | undefined {
  const tier = invocation.values.get("tier") ?? "modes";
  return tier === "base" || tier === "modes" ? tier : undefined;
}

function inMode(make: (workspace: Workspace, mode: string, name: string) => Promise<Generated>): Generator {
  return (workspace, invocation, name) => {
    const mode = invocation.values.get("mode");
    return mode === undefined ? "This kind needs --mode <mode>." : make(workspace, mode, name);
  };
}

const generators: ReadonlyMap<string, Generator> = new Map<string, Generator>([
  [
    "mode",
    (workspace, invocation, name) => {
      const tier = tierOf(invocation);
      return tier === undefined ? "--tier is base or modes." : newMode(workspace, name, tier);
    },
  ],
  ["action", inMode(newAction)],
  ["skill", inMode(newSkill)],
  ["workflow", inMode(newWorkflow)],
  ["interface", (workspace, _invocation, name) => newInterface(workspace, name)],
]);

async function runNew(invocation: Invocation): Promise<CommandResult> {
  const [kind = "", name = ""] = invocation.positionals;
  const generator = generators.get(kind);
  if (generator === undefined) {
    return usageResult(`There is no kind ${kind}; the kinds are ${[...generators.keys()].join(", ")}.`, usage);
  }
  const workspace = { files: invocation.context.ports.files, layout: invocation.layout };
  const generated = generator(workspace, invocation, name);
  if (typeof generated === "string") {
    return usageResult(generated, usage);
  }
  const outcome = await generated;
  if (!outcome.ok) {
    return problemsResult(outcome.problems);
  }
  return succeeded({ written: [...outcome.value] }, outcome.value.map((path) => `+ ${path}`).join("\n"));
}

export const newCommand: Command = {
  name: "new",
  summary: "Write a new mode, action, skill, workflow or interface from its template.",
  usage,
  options: [
    { name: "mode", takesValue: true },
    { name: "tier", takesValue: true },
  ],
  positionals: { least: 2, most: 2 },
  handler: runNew,
};
