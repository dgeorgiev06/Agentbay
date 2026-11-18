import { createHash } from "node:crypto";
import { failed, granted, listed, manifestOf } from "../answers.ts";
import type { Effect, GrantedCommand } from "../contracts.ts";
import type { ProcessOutput, ProcessResult } from "../ports.ts";
import type { CommandOutput, CommandRequest } from "../sdk.ts";
import { checkPath } from "./file-access.ts";
import { dataFolder } from "./file-operations.ts";
import { listInForce } from "./list-in-force.ts";
import { isInsideOrEqual, pathIn, shownPath } from "../layout.ts";
import type { OperationName } from "./operations.ts";
import {
  allowedWith,
  answered,
  askedTo,
  type Asking,
  declaredEffects,
  type Definition,
  type Doing,
  type Entries,
  refusedWith,
  type Ruling,
  type Step,
} from "./rule.ts";

type CommandOperationName = Extract<OperationName, "commands.run">;

type CommandToRun = {
  readonly found: "folder";
  readonly name: string;
  readonly command: readonly string[];
  readonly input?: string;
  readonly directory: string;
  readonly shownDirectory: string;
  readonly milliseconds: number;
};

type NotStarted = { readonly found: "no folder" | "no time"; readonly failure: string };

function describedCommand(request: CommandRequest): string {
  return `run the listed command ${request.name} with ${JSON.stringify(request.arguments)} in ${request.folder}`;
}

function askedToRun(request: CommandRequest, asking: Asking): string {
  return askedTo(describedCommand(request), asking.at);
}

export function lackedEffect(command: GrantedCommand, effects: readonly Effect[]): Effect | undefined {
  return command.effects.find((effect) => !effects.includes(effect));
}

async function listedCommand(request: CommandRequest, asking: Asking): Promise<Ruling<GrantedCommand>> {
  const list = await listInForce(asking);
  if (!list.inForce) {
    return refusedWith({ resource: "commands", asked: askedToRun(request, asking), ...list.refusal });
  }
  const commands = asking.grants.commands;
  const command = commands.find((listedAs) => listedAs.name === request.name);
  if (command === undefined) {
    return refusedWith({
      resource: "commands",
      asked: askedToRun(request, asking),
      declared: `its mode lists the commands: ${listed(
        commands.map((listedAs) => listedAs.name),
        "none",
      )}`,
      change:
        `To allow it, list ${request.name} under resources.commands in ${manifestOf(asking.grants)} ` +
        "with the words it runs and its effects; a mode outside the kit's components/base/ is granted the commands " +
        "it lists only when the owner trusts its list.",
    });
  }
  const missing = lackedEffect(command, asking.effects);
  if (missing === undefined) {
    return allowedWith(command);
  }
  return refusedWith({
    resource: "commands",
    asked: askedToRun(request, asking),
    declared:
      `${declaredEffects(asking.effects, asking.at)}, ` +
      `and ${command.name} is listed with: ${command.effects.join(", ")}`,
    change: `To allow it, add ${missing} to actions.${asking.at.action}.effects in ${asking.at.manifest}.`,
  });
}

function askedMilliseconds(request: CommandRequest, asking: Asking): Ruling<number> {
  const seconds = request.timeLimitSeconds;
  if (Number.isFinite(seconds) && seconds > 0) {
    return allowedWith(seconds * 1000);
  }
  return refusedWith({
    resource: "commands",
    asked: `${askedToRun(request, asking)} with a time limit of ${String(seconds)} seconds`,
    declared: "a command's time limit is a number of seconds above 0",
    change: "Give timeLimitSeconds as a number above 0 in the call to context.commands.run.",
  });
}

function outsideProject(request: CommandRequest, asking: Asking, declared: string): Ruling<never> {
  return refusedWith({
    resource: "commands",
    asked: askedToRun(request, asking),
    declared,
    change:
      'Give a folder of the project in the call to context.commands.run, such as "."; no manifest line allows another.',
  });
}

function noTimeLeft(request: CommandRequest, stepMilliseconds: number): NotStarted {
  return {
    found: "no time",
    failure:
      `The listed command ${request.name} was not started: the step has no time left to run it and still answer ` +
      `before the script's own time limit of ${String(stepMilliseconds / 1000)} seconds.`,
  };
}

type Found = {
  readonly command: GrantedCommand;
  readonly asked: number;
  readonly directory: string;
};

function commandToRun(request: CommandRequest, asking: Asking, found: Found): CommandToRun | NotStarted {
  const left = asking.commandTimeLeft();
  if (left.kind === "none") {
    return noTimeLeft(request, left.stepMilliseconds);
  }
  const { input } = request;
  const { command, directory } = found;
  return {
    found: "folder",
    name: command.name,
    command: [...command.words, ...request.arguments],
    ...(input === undefined ? {} : { input }),
    directory,
    shownDirectory: shownPath(asking.layout, directory),
    milliseconds: Math.min(found.asked, left.milliseconds),
  };
}

async function commandFolder(request: CommandRequest, asking: Asking): Promise<Ruling<string | NotStarted>> {
  const { layout, inspector } = asking;
  const permitted = [layout.project];
  const check = await checkPath(inspector, { layout, path: request.folder, permitted, purpose: "read" });
  if (check.status !== "allowed") {
    return outsideProject(request, asking, "a command runs only in a folder inside the project");
  }
  const real = await inspector.realPath(check.path);
  if (real === undefined) {
    return allowedWith({ found: "no folder", failure: `The folder ${shownPath(layout, check.path)} does not exist.` });
  }
  const data = pathIn(layout, "project", dataFolder);
  const realData = (await inspector.realPath(data)) ?? data;
  if (isInsideOrEqual(check.path, data) || isInsideOrEqual(real, realData)) {
    return outsideProject(request, asking, "a command never runs inside the kernel's state folder .agentbay/");
  }
  return allowedWith(real);
}

function shownOutput(output: ProcessOutput, doing: Doing): CommandOutput {
  const limit = doing.limits.commandOutputCharacters;
  const scrubbed = doing.scrubber.redact(output.text);
  const cut = output.characters > output.text.length || scrubbed.length > limit;
  return { text: scrubbed.slice(-limit), cut };
}

async function recordCommand(
  toRun: CommandToRun,
  ran: { readonly result: ProcessResult; readonly took: number },
  doing: Doing,
): Promise<void> {
  const { name, command, input } = toRun;
  const { result, took } = ran;
  await doing.record("command", {
    step: doing.stepKey,
    name,
    command,
    folder: toRun.shownDirectory,
    end: result.end,
    milliseconds: took,
    ...(input === undefined ? {} : { inputHash: createHash("sha256").update(input, "utf8").digest("hex") }),
    stdoutHash: result.stdout.hash,
    stderrHash: result.stderr.hash,
  });
}

const commandsRun: Definition<"commands.run", CommandToRun | NotStarted> = {
  operation: "commands.run",
  needs: () => [],
  described: describedCommand,
  rule: async (request, asking) => {
    const command = await listedCommand(request, asking);
    if (!command.allowed) {
      return command;
    }
    const asked = askedMilliseconds(request, asking);
    if (!asked.allowed) {
      return asked;
    }
    const folder = await commandFolder(request, asking);
    if (!folder.allowed) {
      return folder;
    }
    if (typeof folder.value !== "string") {
      return allowedWith(folder.value);
    }
    return allowedWith(
      commandToRun(request, asking, { command: command.value, asked: asked.value, directory: folder.value }),
    );
  },
  handler: async (toRun, doing) => {
    if (toRun.found !== "folder") {
      return failed(toRun.failure);
    }
    const [program, ...rest] = toRun.command;
    if (program === undefined) {
      return failed("The command is empty.");
    }
    const startedAt = doing.clock.now().getTime();
    const result = await doing.processes.run({
      command: program,
      arguments: rest,
      directory: toRun.directory,
      environment: { PATH: doing.commandSearchPath },
      timeoutMilliseconds: toRun.milliseconds,
      ...(toRun.input === undefined ? {} : { input: toRun.input }),
    });
    const took = doing.clock.now().getTime() - startedAt;
    await recordCommand(toRun, { result, took }, doing);
    if (result.end.how === "not-started") {
      return failed(`The command ${JSON.stringify(toRun.command)} could not start: ${result.end.reason}`);
    }
    return granted({
      end: result.end,
      milliseconds: took,
      stdout: shownOutput(result.stdout, doing),
      stderr: shownOutput(result.stderr, doing),
    });
  },
  refusalDetail: (request) => ({ name: request.name, arguments: request.arguments, folder: request.folder }),
};

export function commandEntries(step: Step): Entries<CommandOperationName> {
  return {
    "commands.run": (request) => answered(commandsRun, request, step),
  };
}
