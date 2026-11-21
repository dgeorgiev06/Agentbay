import type { Json } from "../../../../../bay/sdk.ts";
import { listAt, numberAt, textAt } from "./json.ts";
import type { Turn } from "./turn.ts";
import { holds, indexOfLetter, joined, lettersOf } from "./words.ts";

const takings = ["choice", "own", "unsure", "pushback"] as const;

type Taking = (typeof takings)[number];

export type Reading = {
  readonly question: number;
  readonly takes: Taking;
  readonly letter?: string;
  readonly words: string;
};

const shortAnswer = /^(\d{1,2})([a-c])$/iu;

function takingOf(text: string): Taking {
  return takings.find((taking) => taking === text) ?? "unsure";
}

function readOf(value: Json): Reading {
  const letter = textAt(value, "letter");
  const read = { question: numberAt(value, "question"), takes: takingOf(textAt(value, "takes")) };
  return letter === ""
    ? { ...read, words: textAt(value, "words") }
    : { ...read, letter, words: textAt(value, "words") };
}

export function readingOf(value: Json): readonly Reading[] {
  return listAt(value, "reading").map(readOf);
}

function choiceCount(turn: Turn, question: number): number {
  return turn.asked[question - 1]?.choices.length ?? 0;
}

function shortRead(token: string, turn: Turn): Reading | undefined {
  const found = shortAnswer.exec(token);
  const question = Number(found?.[1] ?? "0");
  const letter = (found?.[2] ?? "").toLowerCase();
  const index = indexOfLetter(letter);
  return index >= 0 && index < choiceCount(turn, question)
    ? { question, takes: "choice", letter, words: token }
    : undefined;
}

export function shortReading(turn: Turn, said: string): readonly Reading[] | undefined {
  const tokens = said.split(/[\s,;]+/u).filter((token) => token !== "");
  const read = tokens.flatMap((token) => {
    const entry = shortRead(token, turn);
    return entry === undefined ? [] : [entry];
  });
  const questions = new Set(read.map((entry) => entry.question));
  return tokens.length > 0 && read.length === tokens.length && questions.size === read.length ? read : undefined;
}

function letterProblem(turn: Turn, read: Reading): string | undefined {
  if (read.takes !== "choice") {
    return read.letter === undefined
      ? undefined
      : `The reading of question ${String(read.question)} takes ${read.takes} and names the letter ${read.letter}; ` +
          "only a choice names a letter.";
  }
  if (read.letter === undefined) {
    return `The reading of question ${String(read.question)} takes a choice and names no letter; name the letter he chose.`;
  }
  const count = choiceCount(turn, read.question);
  const index = indexOfLetter(read.letter);
  return index >= 0 && index < count
    ? undefined
    : `Question ${String(read.question)} has the choices ${joined(lettersOf(count))}, not ${read.letter}.`;
}

function readProblems(turn: Turn, said: string, read: Reading): readonly string[] {
  if (read.question < 1 || read.question > turn.asked.length) {
    return [`The turn has ${String(turn.asked.length)} questions, so there is no question ${String(read.question)}.`];
  }
  const words = holds(said, read.words)
    ? undefined
    : `The reading of question ${String(read.question)} gives the words "${read.words}", ` +
      "which the owner did not say; give his words exactly.";
  return [letterProblem(turn, read), words].filter((problem) => problem !== undefined);
}

export function readingProblems(turn: Turn, said: string, reading: readonly Reading[]): readonly string[] {
  const questions = reading.map((read) => read.question);
  const twice = [...new Set(questions.filter((question, index) => questions.indexOf(question) !== index))];
  return [
    ...twice.map((question) => `Question ${String(question)} is read twice; read each question once.`),
    ...reading.flatMap((read) => readProblems(turn, said, read)),
  ];
}
