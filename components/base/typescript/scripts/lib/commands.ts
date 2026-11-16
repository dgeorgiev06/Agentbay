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
  readonly command: readonly string[];
  readonly folder: string;
  readonly timeLimitSeconds: number;
};

const tenthsPerSecond = 10;

function secondsSince(context: ScriptContext, started: number): number {
  const tenths = Math.round((context.now().getTime() - started) / (1000 / tenthsPerSecond));
  return tenths / tenthsPerSecond;
}

export async function runTimed(context: ScriptContext, timed: Timed): Promise<Finished> {
  const started = context.now().getTime();
  const answer = await context.commands.run(timed);
  const seconds = secondsSince(context, started);
  if (!answer.ok) {
    return { ending: { how: "not-started", reason: answer.message }, seconds, stdout: "", stderr: "" };
  }
  const { end, stdout, stderr } = answer.value;
  return { ending: end, seconds, stdout: stdout.text, stderr: stderr.text };
}

export function npmRun(script: string): readonly string[] {
  return ["npm", "run", script, "--"];
}

export function isMissingScript(finished: Finished, script: string): boolean {
  const exitedWithOne = finished.ending.how === "exited" && finished.ending.exitCode === 1;
  return exitedWithOne && finished.stderr.startsWith(`npm error Missing script: "${script}"\n`);
}
