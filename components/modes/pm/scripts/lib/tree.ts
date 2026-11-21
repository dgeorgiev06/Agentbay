import type { Json } from "../../../../../bay/sdk.ts";
import { flagAt, listAt, textAt, textsAt } from "./json.ts";
import { joined } from "./words.ts";

const kinds = ["decision", "fact", "prototype"] as const;

type Kind = (typeof kinds)[number];

export type Question = {
  readonly id: string;
  readonly title: string;
  readonly asks: string;
  readonly after: readonly string[];
  readonly kind: Kind;
  readonly settled: boolean;
};

export type Tree = {
  readonly questions: readonly Question[];
};

export type Frontier = {
  readonly frontier: readonly Question[];
  readonly asks: readonly Question[];
  readonly lookUp: readonly Question[];
  readonly untalkable: readonly Question[];
  readonly settled: number;
  readonly waiting: number;
  readonly total: number;
  readonly problems: readonly string[];
};

const mostInATurn = 12;

function kindOf(text: string): Kind {
  return kinds.find((kind) => kind === text) ?? "decision";
}

function questionOf(value: Json): Question {
  return {
    id: textAt(value, "id"),
    title: textAt(value, "title"),
    asks: textAt(value, "asks"),
    after: textsAt(value, "after"),
    kind: kindOf(textAt(value, "kind")),
    settled: flagAt(value, "settled"),
  };
}

export function treeOf(value: Json): Tree {
  return { questions: listAt(value, "questions").map(questionOf) };
}

function firstOfEach(questions: readonly Question[]): readonly Question[] {
  return questions.filter((question, index) => questions.findIndex((other) => other.id === question.id) === index);
}

export function questionNamed(tree: Tree, id: string): Question | undefined {
  return tree.questions.find((question) => question.id === id);
}

function twiceProblems(questions: readonly Question[]): readonly string[] {
  const ids = questions.map((question) => question.id);
  const twice = new Set(ids.filter((id, index) => ids.indexOf(id) !== index));
  return [...twice].map((id) => `${id} is in the tree twice; give each question its own id.`);
}

function unknownAfterProblems(questions: readonly Question[]): readonly string[] {
  const known = new Set(questions.map((question) => question.id));
  return questions.flatMap((question) =>
    question.after
      .filter((id) => !known.has(id))
      .map(
        (id) =>
          `${question.id} comes after ${id}, which is not in the tree; add ${id} or take it out of ${question.id}'s after.`,
      ),
  );
}

function reachesItself(start: Question, afterOf: ReadonlyMap<string, readonly string[]>): boolean {
  const seen = new Set<string>();
  const next = [...start.after];
  while (next.length > 0) {
    const id = next.pop() ?? "";
    if (id === start.id) {
      return true;
    }
    if (!seen.has(id)) {
      seen.add(id);
      next.push(...(afterOf.get(id) ?? []));
    }
  }
  return false;
}

function circleProblems(questions: readonly Question[]): readonly string[] {
  const afterOf = new Map(questions.map((question) => [question.id, question.after]));
  const circling = questions.filter((question) => reachesItself(question, afterOf)).map((question) => question.id);
  if (circling.length === 0) {
    return [];
  }
  if (circling.length === 1) {
    return [`${circling.join("")} comes after itself, so it can never be asked; take it out of its own after.`];
  }
  return [
    `${joined(circling)} come after each other, so none of them can ever be asked; ` +
      "take one of them out of another's after.",
  ];
}

export function treeProblems(tree: Tree): readonly string[] {
  const questions = firstOfEach(tree.questions);
  return [...twiceProblems(tree.questions), ...unknownAfterProblems(questions), ...circleProblems(questions)];
}

export function settledIds(tree: Tree): ReadonlySet<string> {
  return new Set(tree.questions.filter((question) => question.settled).map((question) => question.id));
}

export function unsettledBefore(question: Question, settled: ReadonlySet<string>): readonly string[] {
  return question.after.filter((id) => !settled.has(id));
}

export function frontierOf(tree: Tree, oneAtATime: boolean): Frontier {
  const questions = firstOfEach(tree.questions);
  const settled = settledIds(tree);
  const ready = (question: Question): boolean => unsettledBefore(question, settled).length === 0;
  const open = questions.filter((question) => !question.settled);
  const openDecisions = open.filter((question) => question.kind === "decision");
  const frontier = openDecisions.filter(ready);
  return {
    frontier,
    asks: frontier.slice(0, oneAtATime ? 1 : mostInATurn),
    lookUp: open.filter((question) => question.kind === "fact" && ready(question)),
    untalkable: open.filter((question) => question.kind === "prototype"),
    settled: questions.length - open.length,
    waiting: openDecisions.length - frontier.length,
    total: questions.length,
    problems: treeProblems(tree),
  };
}
