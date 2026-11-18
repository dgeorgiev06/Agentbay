import type { CommandRan } from "../../../../../bay/sdk.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";

export type BayRun =
  | {
      readonly ran: "ended";
      readonly exitCode: number;
      readonly stdout: string;
    }
  | { readonly ran: "not known"; readonly reason: string };

export type RunsInCopy =
  { readonly copied: true; readonly runs: readonly BayRun[] } | { readonly copied: false; readonly reason: string };

const bay = "bay";

function notKnown(reason: string): BayRun {
  return { ran: "not known", reason };
}

function runOf(ran: CommandRan, seconds: number): BayRun {
  switch (ran.end.how) {
    case "timed-out":
      return notKnown(`It did not finish within ${String(seconds)} seconds.`);
    case "signalled":
      return notKnown(`It was stopped by the signal ${ran.end.signal}.`);
    case "exited":
      if (ran.stdout.cut) {
        return notKnown("It printed more than proof reads.");
      }
      return {
        ran: "ended",
        exitCode: ran.end.exitCode,
        stdout: ran.stdout.text,
      };
  }
}

async function bayRun(step: ProofStep, folder: string, words: readonly string[]): Promise<BayRun> {
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
  return runOf(answer.value, seconds);
}

export async function runsInCopy(
  step: ProofStep,
  commit: string,
  words: readonly (readonly string[])[],
): Promise<RunsInCopy> {
  return inCopy(step, commit, async (copy) => {
    if (!copy.made) {
      return { copied: false, reason: copy.reason };
    }
    const runs: BayRun[] = [];
    for (const each of words) {
      runs.push(await bayRun(step, copy.folder, each));
    }
    return { copied: true, runs };
  });
}
