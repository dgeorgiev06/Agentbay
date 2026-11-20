import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { computed, joined, judged, type CardLine } from "./card-lines.ts";
import { listOf, oneOf, textOf } from "./json-values.ts";

export type Held = "held" | "not-held" | "does-not-apply";

export type PracticeAnswer = {
  readonly id: string;
  readonly answer: Held;
  readonly sentence: string;
};

export type HeldBy = "design" | "a plan";

export type Answered = {
  readonly heldBy: HeldBy;
  readonly asked: readonly string[];
  readonly answers: readonly PracticeAnswer[];
};

export type PracticeBlock = {
  readonly answers: readonly PracticeAnswer[];
  readonly heldByRules: readonly string[];
  readonly challenger: string;
};

const helds: readonly Held[] = ["held", "not-held", "does-not-apply"];

function practiceAnswerOf(value: Json): PracticeAnswer {
  const fields = fieldsOf(value);
  const answer = oneOf(helds, fields.answer) ?? "not-held";
  return { id: textOf(fields.id), answer, sentence: textOf(fields.sentence) };
}

export function practiceAnswersOf(value: Json | undefined): readonly PracticeAnswer[] {
  return listOf(value).map(practiceAnswerOf);
}

export function practiceProblems({ heldBy, asked, answers }: Answered): readonly string[] {
  const answered = answers.map((practice) => practice.id);
  const left = asked.filter((id) => !answered.includes(id));
  const unknown = answered.filter((id) => !asked.includes(id));
  const twice = [...new Set(answered.filter((id, at) => answered.indexOf(id) !== at))];
  return [
    ...left.map(
      (id) =>
        `The challenge leaves out the practice ${id}; answer every practice held by ${heldBy}, ` +
        "each held, not-held or does-not-apply, with its sentence.",
    ),
    ...unknown.map(
      (id) => `The challenge answers ${id}, which is not a practice held by ${heldBy}; answer only ${joined(asked)}.`,
    ),
    ...twice.map((id) => `The challenge answers ${id} more than once; answer each practice once.`),
  ];
}

function notHeldIds(answers: readonly PracticeAnswer[]): readonly string[] {
  return answers.filter((practice) => practice.answer === "not-held").map((practice) => practice.id);
}

export function notHeldReason(answers: readonly PracticeAnswer[], heldBy: HeldBy): readonly string[] {
  const notHeld = notHeldIds(answers);
  if (notHeld.length === 0) {
    return [];
  }
  return [`The challenger answered ${joined(notHeld)} not held, and a practice held by ${heldBy} must be held.`];
}

export function practiceLines(block: PracticeBlock): readonly CardLine[] {
  const { answers } = block;
  const count = (answer: Held): number => answers.filter((practice) => practice.answer === answer).length;
  const tally =
    `practices answered by the challenger: ${String(answers.length)}; ${String(count("held"))} held, ` +
    `${String(count("not-held"))} not held, ${String(count("does-not-apply"))} do not apply`;
  const notHeld = answers.filter((practice) => practice.answer === "not-held");
  return [
    computed("draw", `practices held by the script's rules: ${joined(block.heldByRules)}`),
    computed("draw", tally),
    ...notHeld.map((practice) => judged(block.challenger, `${practice.id}, not held: ${practice.sentence}`)),
  ];
}
