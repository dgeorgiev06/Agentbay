import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { practiceProblems, tallyOf, type PracticeAnswer, type Tally } from "./practice-answers.ts";
import type { Practice } from "./practices.ts";
import { mayQuoteAny, quotesAny } from "./quoting.ts";
import { isOneSentence, notQuoting } from "./review-sentences.ts";
import { listOf, numberOf, textOf } from "./json-values.ts";

export type PracticesAsked = {
  readonly ids: readonly string[];
  readonly code: readonly string[];
  readonly tests: readonly { readonly path: string; readonly text: string }[];
};

export type NotHeldPractice = {
  readonly id: string;
  readonly says: string;
  readonly path: string;
  readonly sentence?: string;
};

export type JudgedPractices = {
  readonly tally: Tally;
  readonly notHeld: readonly NotHeldPractice[];
  readonly checks: number;
};

export type Judging = {
  readonly practices: readonly Practice[];
  readonly tests: readonly string[];
  readonly checks: number;
};

function placeProblems(answer: PracticeAnswer, asked: PracticesAsked): readonly string[] {
  const { id, path, sentence } = answer;
  if (path === undefined) {
    return [`The review answers ${id} not held and names no path; give in path the file that breaks it.`];
  }
  const inCode = asked.code.includes(path);
  if (!inCode && !asked.tests.some((test) => test.path === path)) {
    return [
      `The review answers ${id} not held in ${path}, which is neither a file the builder changed nor a test; ` +
        "name one of those.",
    ];
  }
  if (!isOneSentence(sentence)) {
    return [`The review's sentence on ${id} is not one sentence of at most 200 characters.`];
  }
  const texts = asked.tests.map((test) => test.text);
  return inCode && quotesAny(sentence, texts)
    ? [
        `The review's sentence on ${id}, about the builder's code, shares a run of 20 or more characters with the tests: ${notQuoting}`,
      ]
    : [];
}

export function reviewedPracticeProblems(answers: readonly PracticeAnswer[], asked: PracticesAsked): readonly string[] {
  const notHeld = answers.filter((answer) => answer.answer === "not-held");
  return [
    ...practiceProblems({ heldBy: "review", asked: asked.ids, answers }),
    ...notHeld.flatMap((answer) => placeProblems(answer, asked)),
  ];
}

function notHeldOf(answer: PracticeAnswer, judging: Judging): NotHeldPractice {
  const says = judging.practices.find((practice) => practice.id === answer.id)?.says ?? "";
  const placed = { id: answer.id, says, path: answer.path ?? "" };
  return mayQuoteAny(answer.sentence, judging.tests) ? placed : { ...placed, sentence: answer.sentence };
}

export function judgedPractices(answers: readonly PracticeAnswer[], judging: Judging): JudgedPractices {
  const notHeld = answers.filter((answer) => answer.answer === "not-held");
  return {
    tally: tallyOf(answers),
    notHeld: notHeld.map((answer) => notHeldOf(answer, judging)),
    checks: judging.checks,
  };
}

function notHeldPracticeOf(value: Json): NotHeldPractice {
  const fields = fieldsOf(value);
  const placed = { id: textOf(fields.id), says: textOf(fields.says), path: textOf(fields.path) };
  return typeof fields.sentence === "string" ? { ...placed, sentence: fields.sentence } : placed;
}

export function judgedPracticesOf(value: Json | undefined): JudgedPractices | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const fields = fieldsOf(value);
  const tally = fieldsOf(fields.tally ?? null);
  return {
    tally: { held: numberOf(tally.held), notHeld: numberOf(tally.notHeld), doesNotApply: numberOf(tally.doesNotApply) },
    notHeld: listOf(fields.notHeld).map(notHeldPracticeOf),
    checks: numberOf(fields.checks),
  };
}
