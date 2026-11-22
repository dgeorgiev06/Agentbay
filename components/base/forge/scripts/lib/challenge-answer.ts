import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { listOf, oneOf, textOf } from "./json-values.ts";
import { practiceAnswersOf, practiceProblems, type PracticeAnswer } from "./practice-answers.ts";

export type Chosen = "first" | "second" | "merged";

export type Finding = {
  readonly wrong: string;
  readonly where: string;
  readonly fix: string;
};

export type Undecided = {
  readonly sentence: string;
  readonly touches?: string;
};

export type Challenge = {
  readonly chosen: Chosen;
  readonly design: Json | undefined;
  readonly because: string;
  readonly practices: readonly PracticeAnswer[];
  readonly findings: readonly Finding[];
  readonly undecided: readonly Undecided[];
};

export type Asked = {
  readonly designs: number;
  readonly practices: readonly string[];
  readonly touchable: readonly string[];
};

const chosens: readonly Chosen[] = ["first", "second", "merged"];

function findingOf(value: Json): Finding {
  const fields = fieldsOf(value);
  return { wrong: textOf(fields.wrong), where: textOf(fields.where), fix: textOf(fields.fix) };
}

function undecidedOf(value: Json): Undecided {
  const fields = fieldsOf(value);
  const sentence = textOf(fields.sentence);
  return typeof fields.touches === "string" ? { sentence, touches: fields.touches } : { sentence };
}

export function challengeOf(value: Json): Challenge {
  const fields = fieldsOf(value);
  return {
    chosen: oneOf(chosens, fields.chosen) ?? "first",
    design: fields.design,
    because: textOf(fields.because),
    practices: practiceAnswersOf(fields.practices),
    findings: listOf(fields.findings).map(findingOf),
    undecided: listOf(fields.undecided).map(undecidedOf),
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

function touchProblems(challenge: Challenge, asked: Asked): readonly string[] {
  return challenge.undecided.flatMap(({ touches }) =>
    touches === undefined || asked.touchable.includes(touches)
      ? []
      : [
          `An undecided item touches ${touches}, which names no condition or judged requirement of the ` +
            "requirements; name a condition by its id, a judged requirement as J and its place, such as J1, or " +
            "leave touches out.",
        ],
  );
}

export function refusedChallenge(challenge: Challenge, asked: Asked, merged: readonly string[]): readonly string[] {
  const designProblems = merged.map((problem) => `The merged design is refused: ${problem}`);
  const practices = practiceProblems({ heldBy: "design", asked: asked.practices, answers: challenge.practices });
  return [...practices, ...choiceProblems(challenge, asked), ...touchProblems(challenge, asked), ...designProblems];
}
