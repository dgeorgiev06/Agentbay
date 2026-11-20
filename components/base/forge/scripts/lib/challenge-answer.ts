import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { joined } from "./card-lines.ts";
import { listOf, oneOf, textOf } from "./json-values.ts";

export type Held = "held" | "not-held" | "does-not-apply";

export type PracticeAnswer = {
  readonly id: string;
  readonly answer: Held;
  readonly sentence: string;
};

export type Chosen = "first" | "second" | "merged";

export type Challenge = {
  readonly chosen: Chosen;
  readonly design: Json | undefined;
  readonly because: string;
  readonly practices: readonly PracticeAnswer[];
};

export type Asked = {
  readonly designs: number;
  readonly practices: readonly string[];
};

const helds: readonly Held[] = ["held", "not-held", "does-not-apply"];

const chosens: readonly Chosen[] = ["first", "second", "merged"];

function practiceAnswerOf(value: Json): PracticeAnswer {
  const fields = fieldsOf(value);
  const answer = oneOf(helds, fields.answer) ?? "not-held";
  return { id: textOf(fields.id), answer, sentence: textOf(fields.sentence) };
}

export function challengeOf(value: Json): Challenge {
  const fields = fieldsOf(value);
  return {
    chosen: oneOf(chosens, fields.chosen) ?? "first",
    design: fields.design,
    because: textOf(fields.because),
    practices: listOf(fields.practices).map(practiceAnswerOf),
  };
}

function practiceProblems(challenge: Challenge, asked: Asked): readonly string[] {
  const answered = challenge.practices.map((practice) => practice.id);
  const left = asked.practices.filter((id) => !answered.includes(id));
  const unknown = answered.filter((id) => !asked.practices.includes(id));
  const twice = [...new Set(answered.filter((id, at) => answered.indexOf(id) !== at))];
  return [
    ...left.map(
      (id) =>
        `The challenge leaves out the practice ${id}; answer every practice held by design, ` +
        "each held, not-held or does-not-apply, with its sentence.",
    ),
    ...unknown.map(
      (id) =>
        `The challenge answers ${id}, which is not a practice held by design; ` +
        `answer only ${joined(asked.practices)}.`,
    ),
    ...twice.map((id) => `The challenge answers ${id} more than once; answer each practice once.`),
  ];
}

function choiceProblems(challenge: Challenge, asked: Asked): readonly string[] {
  if (challenge.chosen !== "first" && asked.designs < 2) {
    return [`The challenge chose ${challenge.chosen}, but only one design was written; choose first.`];
  }
  if (challenge.chosen === "merged" && challenge.design === undefined) {
    return ["The challenge chose merged but gave no design; give the merged design, or choose first or second."];
  }
  if (challenge.chosen !== "merged" && challenge.design !== undefined) {
    return [`The challenge gave a design but chose ${challenge.chosen}; give a design only when you choose merged.`];
  }
  return [];
}

export function refusedChallenge(challenge: Challenge, asked: Asked, merged: readonly string[]): readonly string[] {
  const designProblems = merged.map((problem) => `The merged design is refused: ${problem}`);
  return [...practiceProblems(challenge, asked), ...choiceProblems(challenge, asked), ...designProblems];
}
