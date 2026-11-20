import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { actionOf, bay, listOf, playerOf, runOf, textAt, type Asked, type Players } from "./kit-copy.ts";

export type Played = {
  readonly asked: readonly Asked[];
  readonly mostAtOnce: number;
  readonly refusedWhileAdvanced: number;
};

type Taken = {
  readonly answer: Json;
  readonly refused: number;
};

const mostTries = 60;

const pauseMilliseconds = 250;

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, pauseMilliseconds));
}

function isAdvancedElsewhere(answer: Json): boolean {
  const said = JSON.stringify(answer);
  const busy = [
    "is being advanced by",
    "Another engine is writing run",
    "(the run is running)",
    "does not wait for a skill",
  ];
  return busy.some((words) => said.includes(words));
}

function hasEnded(answer: Json): boolean {
  return ["undone", "failed"].includes(textAt(runOf(answer), "status"));
}

type Submitting = {
  readonly runId: string;
  readonly task: Json;
  readonly output: Json;
};

async function tokenAgain(root: string, submitting: Submitting): Promise<string> {
  const step = textAt(submitting.task, "stepKey");
  for (let tries = 0; tries < mostTries; tries += 1) {
    const run = runOf(await bay(root, ["runs", submitting.runId, "--new-token", "--step", step]));
    const again = skillTasks(run).find((task) => textAt(task, "stepKey") === step);
    if (again !== undefined) {
      return textAt(again, "token");
    }
    if (textAt(run, "status") !== "running") {
      throw new Error(`The run no longer waits at ${step}: ${JSON.stringify(run)}`);
    }
    await pause();
  }
  throw new Error(`The run was still running after ${String(mostTries)} looks for ${step}.`);
}

async function submittedUntilTaken(root: string, submitting: Submitting): Promise<Taken> {
  let token = textAt(submitting.task, "token");
  for (let refused = 0; refused < mostTries; refused += 1) {
    const answer = await bay(root, ["submit", JSON.stringify(submitting.output), "--token", token]);
    if (fieldsOf(answer).ok === true || hasEnded(answer)) {
      return { answer, refused };
    }
    if (!isAdvancedElsewhere(answer)) {
      throw new Error(`The kernel did not take the output: ${JSON.stringify(answer)}`);
    }
    await pause();
    token = await tokenAgain(root, submitting);
  }
  throw new Error(`The run was still being advanced after ${String(mostTries)} tries.`);
}

function skillTasks(run: Json): readonly Json[] {
  const waits = [fieldsOf(run).waiting ?? null, ...listOf(fieldsOf(run).alsoWaiting)];
  const first = textAt(fieldsOf(run).waiting ?? null, "reason") === "skill" ? [fieldsOf(run).task ?? null] : [];
  const others = waits.slice(1).filter((wait) => textAt(wait, "reason") === "skill");
  return [...first, ...others.map((wait) => fieldsOf(wait).task ?? null)];
}

function played(players: Players, task: Json): Promise<Json> {
  const player = playerOf(players, actionOf(task));
  return player === undefined ? Promise.resolve(null) : player(task);
}

export async function playedSideBySide(root: string, runId: string, players: Players): Promise<Played> {
  const asked: Asked[] = [];
  let mostAtOnce = 0;
  let refusedWhileAdvanced = 0;
  for (;;) {
    const run = runOf(await bay(root, ["runs", runId, "--new-token"]));
    const tasks = textAt(run, "status") === "waiting" ? skillTasks(run) : [];
    const playable = tasks.filter((task) => playerOf(players, actionOf(task)) !== undefined);
    if (playable.length === 0 || playable.length < tasks.length) {
      return { asked, mostAtOnce, refusedWhileAdvanced };
    }
    mostAtOnce = Math.max(mostAtOnce, playable.length);
    asked.push(...playable.map((task) => ({ action: actionOf(task), step: textAt(task, "stepKey"), task })));
    const outputs = await Promise.all(playable.map((task) => played(players, task)));
    const taken = await Promise.all(
      playable.map((task, at) => submittedUntilTaken(root, { runId, task, output: outputs[at] ?? null })),
    );
    refusedWhileAdvanced += taken.reduce((sum, each) => sum + each.refused, 0);
  }
}
