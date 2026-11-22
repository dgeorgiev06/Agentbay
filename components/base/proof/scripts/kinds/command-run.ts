import { fieldsOf, type CommandRan, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import type { Command } from "../lib/request.ts";
import { askedSentence, inCopy, noTimeLeftSentence, type ProofStep, type TimeLimits } from "../lib/step.ts";

export type CommandRun =
  | {
      readonly ran: "ended";
      readonly exitCode: number;
      readonly stdout: string;
    }
  | { readonly ran: "not known"; readonly reason: string };

export type RunsInCopy =
  { readonly copied: true; readonly runs: readonly CommandRun[] } | { readonly copied: false; readonly reason: string };

const bay = "bay";

const printedTooMuch = "It printed more than proof reads.";

function notKnown(reason: string): CommandRun {
  return { ran: "not known", reason };
}

type Asked = { readonly seconds: number; readonly limits: TimeLimits };

function stoppedAfter(asked: Asked): CommandRun {
  const said = `It did not finish within ${String(asked.seconds)} seconds.`;
  return notKnown(`${said} ${askedSentence(asked.limits, asked.seconds)}`);
}

function signalledBy(signal: string): CommandRun {
  return notKnown(`It was stopped by the signal ${signal}.`);
}

function bayRunOf(ran: CommandRan, asked: Asked): CommandRun {
  switch (ran.end.how) {
    case "timed-out":
      return stoppedAfter(asked);
    case "signalled":
      return signalledBy(ran.end.signal);
    case "exited":
      if (ran.stdout.cut) {
        return notKnown(printedTooMuch);
      }
      return {
        ran: "ended",
        exitCode: ran.end.exitCode,
        stdout: ran.stdout.text,
      };
  }
}

function textOf(fields: JsonFields, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : "";
}

function exitedRunOf(fields: JsonFields): CommandRun {
  const { exitCode, stdout, stdoutCut } = fields;
  if (stdoutCut !== false) {
    return notKnown(printedTooMuch);
  }
  if (typeof exitCode !== "number" || typeof stdout !== "string") {
    return notKnown("The toolchain's answer gave no exit code or no output.");
  }
  return { ran: "ended", exitCode, stdout };
}

function toolchainRunOf(value: Json, asked: Asked): CommandRun {
  const fields = fieldsOf(value);
  const reason = textOf(fields, "reason");
  switch (textOf(fields, "ended")) {
    case "exited":
      return exitedRunOf(fields);
    case "timed-out":
      return stoppedAfter(asked);
    case "signalled":
      return signalledBy(textOf(fields, "signal"));
    case "not set up":
      return notKnown(`The toolchain is not set up for it: ${reason}`);
    default:
      return notKnown(`It could not be run: ${reason}`);
  }
}

type Place = { readonly folder: string; readonly seconds: number };

async function bayRun(step: ProofStep, place: Place, words: readonly string[]): Promise<CommandRun> {
  const { folder, seconds } = place;
  const answer = await step.context.commands.run({
    name: bay,
    arguments: words,
    folder,
    timeLimitSeconds: seconds,
  });
  if (!answer.ok) {
    step.spend(seconds);
    return notKnown(`It could not be run: ${answer.message}`);
  }
  step.spend(answer.value.milliseconds / 1000);
  return bayRunOf(answer.value, { seconds, limits: step.limits });
}

async function toolchainRun(
  step: ProofStep,
  place: Place,
  command: { readonly name: string; readonly arguments: readonly string[] },
): Promise<CommandRun> {
  const { folder, seconds } = place;
  const asked = { folder, name: command.name, arguments: command.arguments, timeLimitSeconds: seconds };
  const answer = await step.called("toolchain.run", asked);
  if (!answer.ok) {
    step.spend(seconds);
    return notKnown(`It could not be run: ${answer.reason}`);
  }
  const spent = fieldsOf(answer.value).seconds;
  step.spend(typeof spent === "number" ? spent : seconds);
  return toolchainRunOf(answer.value, { seconds, limits: step.limits });
}

export async function commandRun(step: ProofStep, folder: string, command: Command): Promise<CommandRun> {
  const seconds = step.secondsLeft(1);
  if (seconds < 1) {
    return notKnown(noTimeLeftSentence(step.limits, "run"));
  }
  switch (command.through) {
    case "bay":
      return bayRun(step, { folder, seconds }, command.words);
    case "toolchain":
      return toolchainRun(step, { folder, seconds }, command);
  }
}

export async function runsInCopy(step: ProofStep, commit: string, commands: readonly Command[]): Promise<RunsInCopy> {
  return inCopy(step, commit, async (copy) => {
    if (!copy.made) {
      return { copied: false, reason: copy.reason };
    }
    const runs: CommandRun[] = [];
    for (const each of commands) {
      runs.push(await commandRun(step, copy.folder, each));
    }
    return { copied: true, runs };
  });
}
