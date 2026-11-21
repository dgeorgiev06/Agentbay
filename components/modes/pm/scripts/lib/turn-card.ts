import { computedBy, judgedBy, type Card, type CardLine } from "./card.ts";
import { frontierOf, questionNamed, type Frontier, type Question, type Tree } from "./tree.ts";
import type { Asked, Fact, Sources, Turn } from "./turn.ts";
import { each, holds, joined, letterAt } from "./words.ts";

export type TurnCardInput = {
  readonly job: string;
  readonly number: number;
  readonly tree: Tree;
  readonly turn: Turn;
  readonly oneAtATime: boolean;
  readonly sources: Sources;
};

export type TurnCard = {
  readonly card: Card;
  readonly offered: { readonly answered: boolean };
};

const tooManyQuestions = 60;

const computed = computedBy("draw");

const judged = judgedBy("interview");

function countLine(found: Frontier): CardLine {
  const settled = `${String(found.settled)} of ${String(found.total)} questions are settled.`;
  const waits = each(found.waiting, "waits", "wait");
  return computed(
    `${settled} ${String(found.frontier.length)} can be asked now; ${String(found.waiting)} ${waits} for them.`,
  );
}

function sizeLines(found: Frontier): readonly CardLine[] {
  return found.total > tooManyQuestions
    ? [
        computed(
          `This interview has ${String(found.total)} questions. ` +
            "A scope this large may be better split into smaller files first.",
        ),
      ]
    : [];
}

function foundWords(fact: Fact, sources: Sources): string {
  const source = sources.get(fact.source);
  if (source === undefined || "reason" in source) {
    return `${fact.source} cannot be read, so the words it rests on were not found.`;
  }
  const verb = holds(source.text, fact.quote) ? "holds" : "does not hold";
  return `${fact.source} ${verb} the words it rests on: "${fact.quote}"`;
}

function factLines(fact: Fact, input: TurnCardInput): readonly CardLine[] {
  const title = questionNamed(input.tree, fact.question)?.title ?? "";
  return [judged(`Looked up for ${fact.question}, ${title}: ${fact.says}`), computed(foundWords(fact, input.sources))];
}

function askedLines(asked: Asked, index: number, tree: Tree): readonly CardLine[] {
  const question = questionNamed(tree, asked.question);
  return [
    judged(`${String(index + 1)} ${question?.title ?? asked.question}`),
    judged(question?.asks ?? ""),
    ...asked.choices.map((choice, at) => judged(`${letterAt(at)} ${choice}`)),
    judged(`Recommended: ${asked.recommended}. ${asked.why}`),
  ];
}

function untalkableLines(questions: readonly Question[]): readonly CardLine[] {
  if (questions.length === 0) {
    return [];
  }
  const named = joined(questions.map((question) => `${question.id}, ${question.title}`));
  const goes = each(questions.length, "It goes", "They go");
  return [
    computed(`Not asked, since talking cannot settle it: ${named}. ${goes} to the file as a thing a person judges.`),
  ];
}

function askingCard(input: TurnCardInput, found: Frontier): TurnCard {
  const lines = [
    countLine(found),
    ...sizeLines(found),
    ...input.turn.facts.flatMap((fact) => factLines(fact, input)),
    ...input.turn.asked.flatMap((asked, index) => askedLines(asked, index, input.tree)),
    ...untalkableLines(found.untalkable),
    computed("Answer as 1a 2b, or in your own words. Each answer is read back to you before it is kept."),
  ];
  const title = `Turn ${String(input.number)} of the ${input.job} interview: your answers?`;
  return { card: { title, lines, withheld: {} }, offered: { answered: true } };
}

function blocked(input: TurnCardInput, found: Frontier): { readonly line: string; readonly reason: string } {
  if (found.lookUp.length > 0) {
    return {
      line: `Waiting for facts to be looked up: ${joined(found.lookUp.map((question) => question.id))}.`,
      reason: "No question can be answered until those facts are looked up.",
    };
  }
  return {
    line: `The questions left in the ${input.job} interview wait for ones talking cannot settle.`,
    reason: "No question can be answered by talking now.",
  };
}

function emptyCard(input: TurnCardInput, found: Frontier): TurnCard {
  const facts = input.turn.facts.flatMap((fact) => factLines(fact, input));
  if (found.waiting === 0 && found.lookUp.length === 0) {
    const signOff = computed("Run pm sign-off next: it shows what was understood, for you to sign or not.");
    return {
      card: {
        title: `Nothing is left to ask in the ${input.job} interview`,
        lines: [countLine(found), ...facts, signOff],
        withheld: { answered: "No question is left to answer." },
      },
      offered: { answered: false },
    };
  }
  const { line, reason } = blocked(input, found);
  return {
    card: {
      title: `Nothing can be asked yet in the ${input.job} interview`,
      lines: [countLine(found), ...facts, computed(line)],
      withheld: { answered: reason },
    },
    offered: { answered: false },
  };
}

export function turnCard(input: TurnCardInput): TurnCard {
  const found = frontierOf(input.tree, input.oneAtATime);
  return found.asks.length === 0 ? emptyCard(input, found) : askingCard(input, found);
}
