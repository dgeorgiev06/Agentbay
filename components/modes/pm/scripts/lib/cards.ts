import { computedBy, judgedBy, type Card, type CardLine } from "./card.ts";
import { isOpen, type Interview } from "./interview.ts";
import type { Answers } from "./settings.ts";
import { frontierOf, questionNamed, type Frontier, type Question, type Tree } from "./tree.ts";
import { factChoices, type Asked, type Fact, type Sources, type Turn } from "./turn.ts";
import { counted, each, holds, joined, letterAt } from "./words.ts";

export type Offer = { readonly c: boolean };

export type Item = {
  readonly id: string;
  readonly kind: "question" | "fact";
  readonly title: string;
  readonly job: string;
  readonly turn: number;
  readonly card: Card;
  readonly offer: Offer;
};

export type Drawing = {
  readonly job: string;
  readonly turn: number;
  readonly tree: Tree;
  readonly perTurn: number;
  readonly asked: Turn;
  readonly sources: Sources;
};

const tooManyQuestions = 60;

const computed = computedBy("draw");

const judged = judgedBy("interview");

const twoAnswers = "This card has two answers.";

const answerLine = "Answer with a letter, or later to keep it open for a later turn.";

function countLine(found: Frontier, asked: Turn): CardLine {
  const settled = `${String(found.settled)} of ${String(found.total)} questions are settled.`;
  const asks = `This turn asks ${String(asked.asked.length)} and checks ${counted(asked.facts.length, "fact", "facts")};`;
  return computed(`${settled} ${asks} ${String(found.waiting)} ${each(found.waiting, "waits", "wait")} for them.`);
}

function untalkableLines(found: Frontier): readonly CardLine[] {
  if (found.untalkable.length === 0) {
    return [];
  }
  const named = joined(found.untalkable.map((question) => question.id));
  const goes = each(found.untalkable.length, "It goes", "They go");
  return [
    computed(`Not asked, since talking cannot settle it: ${named}. ${goes} to the file as a thing a person judges.`),
  ];
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

function turnLines(drawing: Drawing): readonly CardLine[] {
  const found = frontierOf(drawing.tree, drawing.perTurn);
  return [countLine(found, drawing.asked), ...sizeLines(found), ...untalkableLines(found)];
}

function choiceLines(choices: readonly string[], mark: (words: string) => CardLine): readonly CardLine[] {
  return choices.map((choice, index) => mark(`${letterAt(index)} ${choice}`));
}

function heldLine(fact: Fact, sources: Sources): CardLine {
  const source = sources.get(fact.source);
  if (source === undefined || "reason" in source) {
    return computed(`${fact.source} could not be read, so these words were not found there: "${fact.quote}"`);
  }
  const verb = holds(source.text, fact.quote) ? "holds" : "does not hold";
  return computed(`${fact.source} ${verb} these words: "${fact.quote}"`);
}

function factLines(fact: Fact, question: Question | undefined, sources: Sources): readonly CardLine[] {
  return [
    judged(`${fact.question} ${question?.title ?? ""}`),
    judged(`Looked up: ${fact.says}`),
    heldLine(fact, sources),
    computed("Is it so?"),
    ...choiceLines(factChoices, computed),
  ];
}

function askedLines(asked: Asked, question: Question | undefined): readonly CardLine[] {
  return [
    judged(`${asked.question} ${question?.title ?? ""}`),
    judged(question?.asks ?? ""),
    ...choiceLines(asked.choices, judged),
    judged(`Recommended: ${asked.recommended}. ${asked.why}`),
  ];
}

type Body = {
  readonly id: string;
  readonly kind: Item["kind"];
  readonly lines: readonly CardLine[];
  readonly choices: number;
};

function bodies(drawing: Drawing): readonly Body[] {
  const facts = drawing.asked.facts.map((fact) => ({
    id: fact.question,
    kind: "fact" as const,
    lines: factLines(fact, questionNamed(drawing.tree, fact.question), drawing.sources),
    choices: factChoices.length,
  }));
  const asked = drawing.asked.asked.map((entry) => ({
    id: entry.question,
    kind: "question" as const,
    lines: askedLines(entry, questionNamed(drawing.tree, entry.question)),
    choices: entry.choices.length,
  }));
  return [...facts, ...asked];
}

function itemOf(drawing: Drawing, body: Body, place: { readonly index: number; readonly count: number }): Item {
  const hasC = body.choices > 2;
  const opening = place.index === 0 ? turnLines(drawing) : [];
  const title = `Turn ${String(drawing.turn)} of the ${drawing.job} interview, card ${String(place.index + 1)} of ${String(place.count)}`;
  return {
    id: body.id,
    kind: body.kind,
    title: questionNamed(drawing.tree, body.id)?.title ?? body.id,
    job: drawing.job,
    turn: drawing.turn,
    card: { title, lines: [...opening, ...body.lines, computed(answerLine)], withheld: hasC ? {} : { c: twoAnswers } },
    offer: { c: hasC },
  };
}

export function itemsOf(drawing: Drawing): readonly Item[] {
  const all = bodies(drawing);
  return all.map((body, index) => itemOf(drawing, body, { index, count: all.length }));
}

const startComputed = computedBy("open");

export type Opening = {
  readonly job: string;
  readonly words: string;
  readonly perTurn: number;
  readonly answers: Answers;
  readonly before: Interview | undefined;
};

function leftHow(before: Interview): string {
  if (before.stopped) {
    return ` You stopped it at turn ${String(before.turn)}.`;
  }
  return isOpen(before) ? ` Its turn ${String(before.turn)} was put to you and not answered.` : "";
}

function beforeLines(before: Interview | undefined): readonly CardLine[] {
  if (before === undefined) {
    return [];
  }
  const found = frontierOf(before, 0);
  const settled = `The interview of ${before.job} has ${String(found.settled)} of ${String(found.total)} questions settled.`;
  const why = leftHow(before);
  return [startComputed(`${settled}${why} Starting again keeps what is settled and asks the open ones.`)];
}

export type StartCard = { readonly card: Card; readonly offered: { readonly start: boolean } };

export function startCard(opening: Opening): StartCard {
  const lines = [
    startComputed(`Your words: "${opening.words}"`),
    ...beforeLines(opening.before),
    startComputed(
      `It asks you questions a turn at a time, at most ${String(opening.perTurn)} a turn, each on its own card ` +
        "with lettered answers and a recommendation. What you answer is kept by the PM mode; no file is written.",
    ),
  ];
  const withheld =
    opening.answers === "free text"
      ? {
          start:
            "Free-text answers are on in settings.pm, and they are not built yet; set freeTextAnswers to false to start.",
        }
      : {};
  const title = `Start an interview of ${opening.job}?`;
  return { card: { title, lines, withheld }, offered: { start: opening.answers === "lettered choices" } };
}
