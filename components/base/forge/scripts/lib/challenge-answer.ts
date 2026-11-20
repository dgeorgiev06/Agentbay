import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { oneOf, textOf } from "./json-values.ts";
import { practiceAnswersOf, practiceProblems, type PracticeAnswer } from "./practice-answers.ts";

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

const chosens: readonly Chosen[] = ["first", "second", "merged"];

export function challengeOf(value: Json): Challenge {
  const fields = fieldsOf(value);
  return {
    chosen: oneOf(chosens, fields.chosen) ?? "first",
    design: fields.design,
    because: textOf(fields.because),
    practices: practiceAnswersOf(fields.practices),
  };
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
  const practices = practiceProblems({ heldBy: "design", asked: asked.practices, answers: challenge.practices });
  return [...practices, ...choiceProblems(challenge, asked), ...designProblems];
}
