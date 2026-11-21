import type { Json } from "../../../../../bay/sdk.ts";
import { listAt, textAt, textsAt } from "./json.ts";
import {
  frontierOf,
  notReadyWords,
  questionNamed,
  questionOf,
  treeProblems,
  type Question,
  type Tree,
} from "./tree.ts";
import { counted, holds, joined, lettersOf, namesChoice, wordCount } from "./words.ts";

export type Asked = {
  readonly question: string;
  readonly choices: readonly string[];
  readonly recommended: string;
  readonly why: string;
};

export type Fact = {
  readonly question: string;
  readonly says: string;
  readonly source: string;
  readonly quote: string;
};

export type Turn = {
  readonly added: readonly Question[];
  readonly asked: readonly Asked[];
  readonly facts: readonly Fact[];
};

export type Source = { readonly text: string } | { readonly reason: string };

export type Sources = ReadonlyMap<string, Source>;

export type Given = {
  readonly tree: Tree;
  readonly perTurn: number;
};

const fewestQuotedWords = 3;

export const factChoices: readonly string[] = ["That is so", "That is not so: ask it as a question"];

function askedOf(value: Json): Asked {
  return {
    question: textAt(value, "question"),
    choices: textsAt(value, "choices"),
    recommended: textAt(value, "recommended"),
    why: textAt(value, "why"),
  };
}

function factOf(value: Json): Fact {
  return {
    question: textAt(value, "question"),
    says: textAt(value, "says"),
    source: textAt(value, "source"),
    quote: textAt(value, "quote"),
  };
}

export function turnOf(value: Json): Turn {
  return {
    added: listAt(value, "added").map(questionOf),
    asked: listAt(value, "asked").map(askedOf),
    facts: listAt(value, "facts").map(factOf),
  };
}

export function sourcePaths(turn: Turn): readonly string[] {
  return [...new Set(turn.facts.map((fact) => fact.source))];
}

function twice(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

function addedProblems(tree: Tree, turn: Turn): readonly string[] {
  const known = (id: string): boolean => questionNamed(tree, id) !== undefined;
  const combined = { questions: [...tree.questions, ...turn.added.filter((question) => !known(question.id))] };
  return [
    ...turn.added
      .filter((question) => known(question.id))
      .map((question) => `${question.id} is in the tree already; give a question you add a new id.`),
    ...turn.added
      .filter((question) => question.settled || question.answer !== undefined)
      .map((question) => `${question.id} is added as settled; only the owner's answer settles a question.`),
    ...treeProblems(combined),
  ];
}

function notDueWhy(id: string, given: Given, turn: Turn): string {
  const { tree, perTurn: due } = given;
  const question = questionNamed(tree, id);
  if (question === undefined) {
    return turn.added.some((added) => added.id === id)
      ? `${id} is added in this turn; it is asked from the next turn on.`
      : `${id} is not in the tree; ask only questions the tree has.`;
  }
  if (question.settled) {
    return `${id} is settled; ask it no more.`;
  }
  switch (question.kind) {
    case "fact":
      return `${id} is a fact: look it up and give it under facts, with its file and the words it rests on.`;
    case "prototype":
      return `${id} is one talking cannot settle; leave it out of the turn.`;
    case "decision":
      return frontierOf(tree, due).frontier.includes(question)
        ? `${id} waits for a later turn: this turn asks ${counted(due, "question", "questions")} at most.`
        : `${id} cannot be asked yet: ${notReadyWords(question, tree)}.`;
  }
}

function coverageProblems(given: Given, turn: Turn): readonly string[] {
  const asked = turn.asked.map((entry) => entry.question);
  const due = frontierOf(given.tree, given.perTurn).asks.map((question) => question.id);
  return [
    ...twice(asked).map((id) => `${id} is asked twice in the turn; ask it once.`),
    ...[...new Set(asked)].filter((id) => !due.includes(id)).map((id) => notDueWhy(id, given, turn)),
    ...due
      .filter((id) => !asked.includes(id))
      .map((id) => `${id} can be asked now and the turn does not ask it; ask it.`),
  ];
}

function choiceProblems(asked: Asked): readonly string[] {
  const repeated = twice(asked.choices).map(
    (choice) => `${asked.question} gives the choice "${choice}" twice; give each choice once.`,
  );
  if (namesChoice(asked.recommended, asked.choices.length)) {
    return repeated;
  }
  const choices = counted(asked.choices.length, "choice", "choices");
  const letters = joined(lettersOf(asked.choices.length));
  return [
    ...repeated,
    `${asked.question} recommends ${asked.recommended}, but it has ${choices}, ${letters}; recommend one of them.`,
  ];
}

function factQuestionProblem(fact: Fact, tree: Tree): string | undefined {
  const question = questionNamed(tree, fact.question);
  if (question === undefined) {
    return `The fact for ${fact.question} names a question the tree does not have.`;
  }
  if (question.settled) {
    return `${fact.question} is settled; give no fact for it.`;
  }
  switch (question.kind) {
    case "decision":
      return `${fact.question} is a decision, which is the owner's; ask it, and give no fact for it.`;
    case "prototype":
      return `${fact.question} is one talking cannot settle; no fact settles it.`;
    case "fact":
      return frontierOf(tree, 0).lookUp.includes(question)
        ? undefined
        : `${fact.question} cannot be looked up yet: ${notReadyWords(question, tree)}.`;
  }
}

function factSourceProblem(fact: Fact, sources: Sources): string | undefined {
  if (wordCount(fact.quote) < fewestQuotedWords) {
    return (
      `The fact for ${fact.question} quotes "${fact.quote}", too few words to find; ` +
      `quote at least ${String(fewestQuotedWords)} words of its file.`
    );
  }
  const source = sources.get(fact.source) ?? { reason: "it was not read." };
  if ("reason" in source) {
    return `The fact for ${fact.question} names ${fact.source}, which cannot be read: ${source.reason}`;
  }
  return holds(source.text, fact.quote)
    ? undefined
    : `The fact for ${fact.question} quotes "${fact.quote}", which ${fact.source} does not hold; quote its words exactly.`;
}

function factProblems(tree: Tree, turn: Turn, sources: Sources): readonly string[] {
  const ids = turn.facts.map((fact) => fact.question);
  return [
    ...twice(ids).map((id) => `${id} has more than one fact; give one fact for a question.`),
    ...turn.facts.flatMap((fact) =>
      [factQuestionProblem(fact, tree), factSourceProblem(fact, sources)].filter((problem) => problem !== undefined),
    ),
  ];
}

export function turnProblems(given: Given, turn: Turn, sources: Sources): readonly string[] {
  return [
    ...addedProblems(given.tree, turn),
    ...coverageProblems(given, turn),
    ...turn.asked.flatMap(choiceProblems),
    ...factProblems(given.tree, turn, sources),
  ];
}
