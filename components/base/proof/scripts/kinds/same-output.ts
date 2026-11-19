import type { Command, DeclaredCommand, Request } from "../lib/request.ts";
import type { ProofStep } from "../lib/step.ts";
import { broken, counted, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";
import { runsInCopy, type CommandRun } from "./command-run.ts";

export type CommandRuns = {
  readonly name: string;
  readonly base: CommandRun;
  readonly head: CommandRun;
};

export type SameOutputEvidence =
  | { readonly found: "not copied"; readonly reason: string }
  | { readonly found: "ran"; readonly commands: readonly CommandRuns[] };

type Expected = "same" | "differs";

const noCommands = "This project declares no commands whose output must not change, so nothing is known.";

function sideNotKnown(name: string, side: "base" | "head", run: CommandRun): Part | undefined {
  return run.ran === "not known"
    ? unknown(`The output of ${name} at the ${side} is not known. ${run.reason}`)
    : undefined;
}

function commandPart(command: CommandRuns, expected: Expected): Part {
  const { name, base, head } = command;
  if (base.ran === "not known" || head.ran === "not known") {
    return sideNotKnown(name, "base", base) ?? sideNotKnown(name, "head", head) ?? held;
  }
  const same = base.exitCode === head.exitCode && base.stdout === head.stdout;
  if (expected === "differs") {
    return same ? broken(`${name} printed the same at the base and the head, though the item says it differs.`) : held;
  }
  return same ? held : broken(`${name} printed or ended otherwise at the head than at the base.`);
}

function nothingKnown(reason: string): Parts {
  return { parts: [unknown(reason)], whenPassed: "" };
}

export function sameOutputParts(differ: readonly string[], evidence: SameOutputEvidence): Parts {
  if (evidence.found === "not copied") {
    return nothingKnown(evidence.reason);
  }
  const names = evidence.commands.map((command) => command.name);
  const [first, ...rest] = evidence.commands.map((command) =>
    commandPart(command, differ.includes(command.name) ? "differs" : "same"),
  );
  if (first === undefined) {
    return nothingKnown(noCommands);
  }
  const strangers = differ.filter((name) => !names.includes(name)).length;
  if (strangers > 0) {
    const named = counted(strangers, "command", "commands");
    return nothingKnown(`The item names ${named} in differ that the project does not declare, so nothing is known.`);
  }
  const all = String(names.length);
  const differing = counted(differ.length, "of them differs", "of them differ");
  return {
    parts: [first, ...rest],
    whenPassed: `Every declared command printed as the item says: ${all} of ${all}, and ${differing} as named.`,
  };
}

function commandsOf(declared: readonly DeclaredCommand[]): readonly Command[] {
  return declared.map((each) => each.command);
}

export async function sameOutputEvidence(step: ProofStep, request: Request): Promise<SameOutputEvidence> {
  const commands = request.sameOutput;
  if (commands.length === 0) {
    return { found: "ran", commands: [] };
  }
  const base = await runsInCopy(step, request.base, commandsOf(commands));
  if (!base.copied) {
    return { found: "not copied", reason: base.reason };
  }
  const head = await runsInCopy(step, request.head, commandsOf(commands));
  if (!head.copied) {
    return { found: "not copied", reason: head.reason };
  }
  return {
    found: "ran",
    commands: commands.map((command, index) => ({
      name: command.name,
      base: base.runs[index] ?? { ran: "not known", reason: "It was not run." },
      head: head.runs[index] ?? { ran: "not known", reason: "It was not run." },
    })),
  };
}

export async function proveSameOutput(
  step: ProofStep,
  request: Request,
  proof: { readonly differ: readonly string[] },
): Promise<Parts> {
  return sameOutputParts(proof.differ, await sameOutputEvidence(step, request));
}
