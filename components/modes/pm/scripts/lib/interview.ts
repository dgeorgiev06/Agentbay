import type { Json } from "../../../../../bay/sdk.ts";
import { flagAt, listAt, numberAt, textAt } from "./json.ts";
import { questionOf, type Question } from "./tree.ts";

export type Words = {
  readonly namedBy: string;
  readonly on: string;
  readonly words: string;
};

export type Interview = {
  readonly job: string;
  readonly asked: readonly Words[];
  readonly turn: number;
  readonly openTurn: string;
  readonly stopped: boolean;
  readonly questions: readonly Question[];
};

const startWorkflow = "pm:workflows/start.yaml";

const askWorkflow = "pm:workflows/ask.yaml";

export function nextTurnCommand(job: string): string {
  return `bay call --workflow ${askWorkflow} '{"job": "${job}"}' --json`;
}

function seed(id: string, title: string, asks: string): Question {
  return { id, title, asks, after: [], kind: "decision", settled: false };
}

const seeds: readonly Question[] = [
  seed("Q1", "Who it is for", "Who is this work for, and what do they do with it?"),
  seed("Q2", "Seen working", "What does a person see when it works?"),
  seed("Q3", "Left out", "What is left out of this work on purpose?"),
];

function wordsOf(value: Json): Words {
  return { namedBy: textAt(value, "namedBy"), on: textAt(value, "on"), words: textAt(value, "words") };
}

export function interviewOf(value: Json): Interview {
  return {
    job: textAt(value, "job"),
    asked: listAt(value, "asked").map(wordsOf),
    turn: numberAt(value, "turn"),
    openTurn: textAt(value, "openTurn"),
    stopped: flagAt(value, "stopped"),
    questions: listAt(value, "questions").map(questionOf),
  };
}

export function started(before: Interview | undefined, job: string, words: Words): Interview {
  if (before === undefined) {
    return { job, asked: [words], turn: 1, openTurn: "", stopped: false, questions: seeds };
  }
  return { ...before, asked: [...before.asked, words], openTurn: "", stopped: false };
}

function startAgain(job: string): string {
  return `ask the owner to start it again with the workflow ${startWorkflow} and the job ${job}`;
}

export function turnRefusal(interview: Interview | undefined, job: string): string | undefined {
  if (interview === undefined) {
    return `No interview of ${job} was started; only the owner starts one, with the workflow ${startWorkflow}.`;
  }
  if (interview.stopped) {
    return `The owner stopped the interview of ${job}; ${startAgain(job)}.`;
  }
  if (isOpen(interview)) {
    return (
      `Turn ${String(interview.turn)} of the interview of ${job} is open and nothing of it was kept; ` +
      `${startAgain(job)}.`
    );
  }
  return undefined;
}

export function isOpen(interview: Interview): boolean {
  return interview.openTurn !== "";
}

export function opened(interview: Interview, token: string): Interview {
  return { ...interview, openTurn: token };
}

export function stopped(interview: Interview): Interview {
  return { ...interview, openTurn: "", stopped: true };
}
