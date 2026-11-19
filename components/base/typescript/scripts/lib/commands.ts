import type { ScriptContext } from "../../../../../bay/sdk.ts";

type CommandAnswer = Awaited<ReturnType<ScriptContext["commands"]["run"]>>;

type RanEnd = Extract<CommandAnswer, { readonly ok: true }>["value"]["end"];

export type Ending = RanEnd | { readonly how: "not-started"; readonly reason: string };

export type Finished = {
  readonly ending: Ending;
  readonly seconds: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type Timed = {
  readonly name: string;
  readonly arguments: readonly string[];
  readonly folder: string;
  readonly timeLimitSeconds: number;
};

const millisecondsPerTenth = 100;

function secondsOf(milliseconds: number): number {
  return Math.round(milliseconds / millisecondsPerTenth) / 10;
}

export async function runTimed(context: ScriptContext, timed: Timed): Promise<Finished> {
  const { name, folder, timeLimitSeconds } = timed;
  const answer = await context.commands.run({ name, arguments: timed.arguments, folder, timeLimitSeconds });
  if (!answer.ok) {
    return { ending: { how: "not-started", reason: answer.message }, seconds: 0, stdout: "", stderr: "" };
  }
  const { end, milliseconds, stdout, stderr } = answer.value;
  return { ending: end, seconds: secondsOf(milliseconds), stdout: stdout.text, stderr: stderr.text };
}

export type Ended =
  { readonly kind: "unfinished"; readonly reason: string } | { readonly kind: "exited"; readonly exitCode: number };

function unfinished(reason: string): Ended {
  return { kind: "unfinished", reason };
}

export function notStartedReason(subject: string, reason: string): string {
  return `${subject} could not be started: ${reason}`;
}

export function endedOf(subject: string, finished: Finished, timeLimitSeconds: number): Ended {
  const ending = finished.ending;
  switch (ending.how) {
    case "not-started":
      return unfinished(notStartedReason(subject, ending.reason));
    case "timed-out":
      return unfinished(`${subject} did not finish within ${String(timeLimitSeconds)} seconds and was stopped.`);
    case "signalled":
      return unfinished(`${subject} was stopped by the signal ${ending.signal}.`);
    case "exited":
      return { kind: "exited", exitCode: ending.exitCode };
  }
}

const folderSeconds = 10;

export async function realFolder(context: ScriptContext, folder: string): Promise<string> {
  const printed = await runTimed(context, {
    name: "print-folder",
    arguments: [],
    folder,
    timeLimitSeconds: folderSeconds,
  });
  const { ending } = printed;
  return ending.how === "exited" && ending.exitCode === 0 ? printed.stdout.trim() : "";
}
