import type { Json } from "../../../../../bay/sdk.ts";
import { listAt, textAt, textsAt } from "./json.ts";
import {
  frontierOf,
  questionNamed,
  settledIds,
  unsettledBefore,
  type Frontier,
  type Question,
  type Tree,
} from "./tree.ts";
import { each, holds, indexOfLetter, joined, lettersOf } from "./words.ts";

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
  readonly asked: readonly Asked[];
  readonly facts: readonly Fact[];
};

export type Source = { readonly text: string } | { readonly reason: string };

export type Sources = ReadonlyMap<string, Source>;

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
  return { asked: listAt(value, "asked").map(askedOf), facts: listAt(value, "facts").map(factOf) };
}

export function sourcePaths(turn: Turn): readonly string[] {
  return [...new Set(turn.facts.map((fact) => fact.source))];
}

function notReadyWhy(question: Question, tree: Tree): string {
  const before = unsettledBefore(question, settledIds(tree));
  const which = each(before.length, "which is", "which are");
  return `${question.id} cannot be asked yet: it comes after ${joined(before)}, ${which} not settled.`;
}

function notAskedWhy(id: string, tree: Tree, found: Frontier): string {
  const question = questionNamed(tree, id);
  if (question === undefined) {
    return `${id} is not in the tree; ask only questions the tree has.`;
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
      return found.frontier.includes(question)
        ? `${id} waits for a later turn: this turn asks ${String(found.asks.length)} questions at most.`
        : notReadyWhy(question, tree);
  }
}

function coverageProblems(tree: Tree, turn: Turn, found: Frontier): readonly string[] {
  const asked = turn.asked.map((entry) => entry.question);
  const due = found.asks.map((question) => question.id);
  const twice = [...new Set(asked.filter((id, index) => asked.indexOf(id) !== index))];
  return [
    ...twice.map((id) => `${id} is asked twice in the turn; ask it once.`),
    ...[...new Set(asked)].filter((id) => !due.includes(id)).map((id) => notAskedWhy(id, tree, found)),
    ...due
      .filter((id) => !asked.includes(id))
      .map((id) => `${id} can be asked now and the turn does not ask it; ask it.`),
  ];
}

function recommendedProblems(asked: Asked): readonly string[] {
  const index = indexOfLetter(asked.recommended);
  if (index >= 0 && index < asked.choices.length) {
    return [];
  }
  const letters = joined(lettersOf(asked.choices.length));
  return [
    `${asked.question} recommends ${asked.recommended}, but it has ${String(asked.choices.length)} choices, ` +
      `${letters}; recommend one of them.`,
  ];
}

function factKindProblem(fact: Fact, tree: Tree): string | undefined {
  const question = questionNamed(tree, fact.question);
  if (question === undefined) {
    return `The fact for ${fact.question} names a question the tree does not have.`;
  }
  switch (question.kind) {
    case "decision":
      return `${fact.question} is a decision, which is the owner's; ask it, and give no fact for it.`;
    case "prototype":
      return `${fact.question} is one talking cannot settle; no fact settles it.`;
    case "fact":
      return undefined;
  }
}

function factSourceProblem(fact: Fact, sources: Sources): string | undefined {
  const source = sources.get(fact.source) ?? { reason: "it was not read." };
  if ("reason" in source) {
    return `The fact for ${fact.question} names ${fact.source}, which cannot be read: ${source.reason}`;
  }
  return holds(source.text, fact.quote)
    ? undefined
    : `The fact for ${fact.question} quotes "${fact.quote}", which ${fact.source} does not hold; quote its words exactly.`;
}

function factProblems(tree: Tree, turn: Turn, sources: Sources): readonly string[] {
  return turn.facts.flatMap((fact) =>
    [factKindProblem(fact, tree), factSourceProblem(fact, sources)].filter((problem) => problem !== undefined),
  );
}

export type TurnChecked = {
  readonly tree: Tree;
  readonly turn: Turn;
  readonly oneAtATime: boolean;
  readonly sources: Sources;
};

export function turnProblems(checked: TurnChecked): readonly string[] {
  const { tree, turn, oneAtATime, sources } = checked;
  const found = frontierOf(tree, oneAtATime);
  return [
    ...found.problems,
    ...coverageProblems(tree, turn, found),
    ...turn.asked.flatMap(recommendedProblems),
    ...factProblems(tree, turn, sources),
  ];
}
