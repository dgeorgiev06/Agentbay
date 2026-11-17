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

function isMissingScript(finished: Finished, script: string): boolean {
  const exitedWithOne = finished.ending.how === "exited" && finished.ending.exitCode === 1;
  return exitedWithOne && finished.stderr.startsWith(`npm error Missing script: "${script}"\n`);
}

export type Ended =
  { readonly kind: "unfinished"; readonly reason: string } | { readonly kind: "exited"; readonly exitCode: number };

function unfinished(reason: string): Ended {
  return { kind: "unfinished", reason };
}

export function endedOf(
  ran: { readonly subject: string; readonly script: string },
  finished: Finished,
  timeLimitSeconds: number,
): Ended {
  const ending = finished.ending;
  switch (ending.how) {
    case "not-started":
      return unfinished(`${ran.subject} could not be started: ${ending.reason}`);
    case "timed-out":
      return unfinished(`${ran.subject} did not finish within ${String(timeLimitSeconds)} seconds and was stopped.`);
    case "signalled":
      return unfinished(`${ran.subject} was stopped by the signal ${ending.signal}.`);
    case "exited":
      return isMissingScript(finished, ran.script)
        ? unfinished(`The checkout's package.json has no script ${ran.script}, so it could not be started.`)
        : { kind: "exited", exitCode: ending.exitCode };
  }
}
