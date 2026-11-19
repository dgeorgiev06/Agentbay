import { fieldsOf, type CommandRan, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import type { Command } from "../lib/request.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";

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

function stoppedAfter(seconds: number): CommandRun {
  return notKnown(`It did not finish within ${String(seconds)} seconds.`);
}

function signalledBy(signal: string): CommandRun {
  return notKnown(`It was stopped by the signal ${signal}.`);
}

function bayRunOf(ran: CommandRan, seconds: number): CommandRun {
  switch (ran.end.how) {
    case "timed-out":
      return stoppedAfter(seconds);
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

function toolchainRunOf(value: Json, seconds: number): CommandRun {
  const fields = fieldsOf(value);
  const reason = textOf(fields, "reason");
  switch (textOf(fields, "ended")) {
    case "exited":
      return exitedRunOf(fields);
    case "timed-out":
      return stoppedAfter(seconds);
    case "signalled":
      return signalledBy(textOf(fields, "signal"));
    case "not set up":
      return notKnown(`The toolchain is not set up for it: ${reason}`);
    default:
      return notKnown(`It could not be run: ${reason}`);
  }
}

async function bayRun(step: ProofStep, folder: string, words: readonly string[]): Promise<CommandRun> {
  const seconds = step.secondsLeft(1);
  if (seconds < 1) {
    return notKnown("Proof's own step had no time left for it, so it was not run.");
  }
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
  return bayRunOf(answer.value, seconds);
}

async function toolchainRun(
  step: ProofStep,
  folder: string,
  command: { readonly name: string; readonly arguments: readonly string[] },
): Promise<CommandRun> {
  const seconds = step.secondsLeft(1);
  if (seconds < 1) {
    return notKnown("Proof's own step had no time left for it, so it was not run.");
  }
  const asked = { folder, name: command.name, arguments: command.arguments, timeLimitSeconds: seconds };
  const answer = await step.called("toolchain.run", asked);
  if (!answer.ok) {
    step.spend(seconds);
    return notKnown(`It could not be run: ${answer.reason}`);
  }
  const spent = fieldsOf(answer.value).seconds;
  step.spend(typeof spent === "number" ? spent : seconds);
  return toolchainRunOf(answer.value, seconds);
}

function commandRun(step: ProofStep, folder: string, command: Command): Promise<CommandRun> {
  switch (command.through) {
    case "bay":
      return bayRun(step, folder, command.words);
    case "toolchain":
      return toolchainRun(step, folder, command);
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
