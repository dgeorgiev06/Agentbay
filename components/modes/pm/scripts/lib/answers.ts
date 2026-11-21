import type { Json } from "../../../../../bay/sdk.ts";
import type { Interview } from "./interview.ts";
import { textAt } from "./json.ts";
import type { Question } from "./tree.ts";
import { factChoices, type Turn } from "./turn.ts";
import { choiceAt, counted, joined, namesChoice } from "./words.ts";

export type Answer = {
  readonly id: string;
  readonly choice: string;
};

const later = "later";

type Due = {
  readonly id: string;
  readonly choices: readonly string[];
  readonly settles: (question: Question, choice: string) => Question;
};

export function answerOf(value: Json): Answer {
  return { id: textAt(value, "id"), choice: textAt(value, "choice") };
}

function settledAs(answer: string): (question: Question) => Question {
  return (question) => ({ ...question, settled: true, answer });
}

function dueOf(turn: Turn): readonly Due[] {
  const facts = turn.facts.map((fact) => ({
    id: fact.question,
    choices: factChoices,
    settles: (question: Question, choice: string): Question =>
      choiceAt(factChoices, choice) === factChoices[0]
        ? settledAs(fact.says)(question)
        : { ...question, kind: "decision" as const },
  }));
  const asked = turn.asked.map((entry) => ({
    id: entry.question,
    choices: entry.choices,
    settles: (question: Question, choice: string): Question =>
      settledAs(choiceAt(entry.choices, choice) ?? "")(question),
  }));
  return [...facts, ...asked];
}

function choiceProblem(due: Due, answer: Answer): string | undefined {
  if (answer.choice === later || namesChoice(answer.choice, due.choices.length)) {
    return undefined;
  }
  return `${due.id} was answered ${answer.choice}, which is not one of its ${counted(due.choices.length, "choice", "choices")} or later.`;
}

export function answerProblems(turn: Turn, answers: readonly Answer[]): readonly string[] {
  const due = dueOf(turn);
  const ids = answers.map((answer) => answer.id);
  const missing = due.filter((entry) => !ids.includes(entry.id)).map((entry) => entry.id);
  const unknown = answers.filter((answer) => !due.some((entry) => entry.id === answer.id)).map((answer) => answer.id);
  const twice = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  return [
    ...(missing.length === 0 ? [] : [`The turn's answers leave out ${joined(missing)}.`]),
    ...(unknown.length === 0 ? [] : [`The turn's answers name ${joined(unknown)}, which the turn did not ask.`]),
    ...twice.map((id) => `${id} is answered twice.`),
    ...answers.flatMap((answer) => {
      const entry = due.find((each) => each.id === answer.id);
      const problem = entry === undefined ? undefined : choiceProblem(entry, answer);
      return problem === undefined ? [] : [problem];
    }),
  ];
}

function answered(question: Question, due: readonly Due[], answers: readonly Answer[]): Question {
  const answer = answers.find((each) => each.id === question.id);
  const entry = due.find((each) => each.id === question.id);
  if (answer === undefined || entry === undefined || answer.choice === later) {
    return question;
  }
  return entry.settles(question, answer.choice);
}

export function recorded(interview: Interview, turn: Turn, answers: readonly Answer[]): Interview {
  const due = dueOf(turn);
  const questions = [...interview.questions, ...turn.added].map((question) => answered(question, due, answers));
  return { ...interview, questions, turn: interview.turn + 1, open: false };
}
