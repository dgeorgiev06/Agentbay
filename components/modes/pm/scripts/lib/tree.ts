import type { Json } from "../../../../../bay/sdk.ts";
import { flagAt, textAt, textsAt } from "./json.ts";
import { each, joined } from "./words.ts";

const kinds = ["decision", "fact", "prototype"] as const;

type Kind = (typeof kinds)[number];

export type Question = {
  readonly id: string;
  readonly title: string;
  readonly asks: string;
  readonly after: readonly string[];
  readonly kind: Kind;
  readonly settled: boolean;
  readonly answer?: string;
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

function kindOf(text: string): Kind {
  return kinds.find((kind) => kind === text) ?? "decision";
}

export function questionOf(value: Json): Question {
  const answer = textAt(value, "answer");
  const question = {
    id: textAt(value, "id"),
    title: textAt(value, "title"),
    asks: textAt(value, "asks"),
    after: textsAt(value, "after"),
    kind: kindOf(textAt(value, "kind")),
    settled: flagAt(value, "settled"),
  };
  return answer === "" ? question : { ...question, answer };
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

function selfProblems(questions: readonly Question[]): readonly string[] {
  return questions
    .filter((question) => question.after.includes(question.id))
    .map((question) => `${question.id} comes after itself, so it can never be asked; take it out of its own after.`);
}

function circleProblems(questions: readonly Question[]): readonly string[] {
  const afterOf = new Map(questions.map((question) => [question.id, question.after]));
  const circling = questions
    .filter((question) => !question.after.includes(question.id) && reachesItself(question, afterOf))
    .map((question) => question.id);
  return circling.length < 2
    ? []
    : [
        `${joined(circling)} come after each other, so none of them can ever be asked; ` +
          "take one of them out of another's after.",
      ];
}

export function treeProblems(tree: Tree): readonly string[] {
  const questions = firstOfEach(tree.questions);
  return [
    ...twiceProblems(tree.questions),
    ...unknownAfterProblems(questions),
    ...selfProblems(questions),
    ...circleProblems(questions),
  ];
}

function settledIds(tree: Tree): ReadonlySet<string> {
  return new Set(tree.questions.filter((question) => question.settled).map((question) => question.id));
}

function unsettledBefore(question: Question, tree: Tree): readonly string[] {
  const settled = settledIds(tree);
  return question.after.filter((id) => !settled.has(id));
}

export function isReady(question: Question, tree: Tree): boolean {
  return unsettledBefore(question, tree).length === 0;
}

export function notReadyWords(question: Question, tree: Tree): string {
  const before = unsettledBefore(question, tree);
  return `it comes after ${joined(before)}, ${each(before.length, "which is", "which are")} not settled`;
}

export function frontierOf(tree: Tree, perTurn: number): Frontier {
  const questions = firstOfEach(tree.questions);
  const open = questions.filter((question) => !question.settled);
  const openDecisions = open.filter((question) => question.kind === "decision");
  const frontier = openDecisions.filter((question) => isReady(question, tree));
  return {
    frontier,
    asks: frontier.slice(0, perTurn),
    lookUp: open.filter((question) => question.kind === "fact" && isReady(question, tree)),
    untalkable: open.filter((question) => question.kind === "prototype"),
    settled: questions.length - open.length,
    waiting: openDecisions.length - frontier.length,
    total: questions.length,
    problems: treeProblems(tree),
  };
}
