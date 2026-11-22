import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import { computed, counted, joined, judged, shortened, type CardLine } from "./card-lines.ts";
import { listOf, oneOf, textOf } from "./json-values.ts";

export type Held = "held" | "not-held" | "does-not-apply";

export type PracticeAnswer = {
  readonly id: string;
  readonly answer: Held;
  readonly sentence: string;
  readonly path?: string;
};

export type ChallengedBy = "design" | "a plan";

export type HeldBy = ChallengedBy | "review";

export type Answered = {
  readonly heldBy: HeldBy;
  readonly asked: readonly string[];
  readonly answers: readonly PracticeAnswer[];
};

export type Tally = {
  readonly held: number;
  readonly notHeld: number;
  readonly doesNotApply: number;
};

export type NotHeld = {
  readonly id: string;
  readonly sentence: string;
  readonly level?: "must";
  readonly says?: string;
  readonly path?: string;
};

export type PracticeBlock = {
  readonly answers: readonly PracticeAnswer[];
  readonly heldByRules: readonly string[];
  readonly challenger: string;
};

const helds: readonly Held[] = ["held", "not-held", "does-not-apply"];

const answerNames: Readonly<Record<HeldBy, string>> = {
  design: "The challenge",
  "a plan": "The challenge",
  review: "The review",
};

const saysShown = 80;

function practiceAnswerOf(value: Json): PracticeAnswer {
  const fields = fieldsOf(value);
  const answer = oneOf(helds, fields.answer) ?? "not-held";
  const answered = { id: textOf(fields.id), answer, sentence: textOf(fields.sentence) };
  return typeof fields.path === "string" ? { ...answered, path: fields.path } : answered;
}

export function practiceAnswersOf(value: Json | undefined): readonly PracticeAnswer[] {
  return listOf(value).map(practiceAnswerOf);
}

export function askedPractices(asked: Json): readonly string[] {
  return listOf(fieldsOf(asked).practices).map((practice) => textOf(fieldsOf(practice).id));
}

type Once = {
  readonly left: readonly string[];
  readonly unknown: readonly string[];
  readonly twice: readonly string[];
};

function answeredOnce(asked: readonly string[], answered: readonly string[]): Once {
  return {
    left: asked.filter((id) => !answered.includes(id)),
    unknown: answered.filter((id) => !asked.includes(id)),
    twice: [...new Set(answered.filter((id, at) => answered.indexOf(id) !== at))],
  };
}

type Asker = {
  readonly named: string;
  readonly heldBy: HeldBy;
  readonly asked: readonly string[];
};

function onceProblems({ named, heldBy, asked }: Asker, once: Once): readonly string[] {
  return [
    ...once.unknown.map(
      (id) => `${named} answers ${id}, which is not a practice held by ${heldBy}; answer only ${joined(asked)}.`,
    ),
    ...once.twice.map((id) => `${named} answers ${id} more than once; answer each practice once.`),
  ];
}

export function practiceProblems({ heldBy, asked, answers }: Answered): readonly string[] {
  const named = answerNames[heldBy];
  const once = answeredOnce(
    asked,
    answers.map((practice) => practice.id),
  );
  return [
    ...once.left.map(
      (id) =>
        `${named} leaves out the practice ${id}; answer every practice held by ${heldBy}, ` +
        "each held, not-held or does-not-apply, with its sentence.",
    ),
    ...onceProblems({ named, heldBy, asked }, once),
  ];
}

export function designerPracticeProblems(asked: readonly string[], said: readonly string[]): readonly string[] {
  const once = answeredOnce(asked, said);
  return [
    ...once.left.map(
      (id) =>
        `The design does not say how it holds the practice ${id}; add it to practices with one sentence on how ` +
        "the design holds it, or why it does not apply.",
    ),
    ...onceProblems({ named: "The design", heldBy: "design", asked }, once),
  ];
}

export function notHeldIds(answers: readonly PracticeAnswer[]): readonly string[] {
  return answers.filter((practice) => practice.answer === "not-held").map((practice) => practice.id);
}

export type FirstFound = {
  readonly notHeld: readonly string[];
  readonly findings: number;
};

const answerers: Readonly<Record<ChallengedBy, { readonly who: string; readonly run: string }>> = {
  design: { who: "designer", run: "design" },
  "a plan": { who: "planner", run: "plan" },
};

export const decidingWords = "the second challenge's answers decide the card";

export function firstFoundWords(found: FirstFound, heldBy: ChallengedBy): string {
  const notHeld = found.notHeld.length === 0 ? [] : [`answered ${joined(found.notHeld)} not held`];
  const findings = found.findings === 0 ? [] : [`gave ${counted(found.findings, "finding")}`];
  return `the first challenge ${joined([...notHeld, ...findings])}; the ${answerers[heldBy].who} answered once`;
}

export function withheldAfterAnswer(
  answers: readonly PracticeAnswer[],
  heldBy: ChallengedBy,
  answered: boolean,
): readonly string[] {
  const notHeld = notHeldReason(answers, heldBy);
  const { who, run } = answerers[heldBy];
  const once = `The ${who} has answered the challenge once, which is the most a ${run} run asks.`;
  return notHeld.length > 0 && answered ? [...notHeld, once] : notHeld;
}

function notHeldReason(answers: readonly PracticeAnswer[], heldBy: ChallengedBy): readonly string[] {
  const notHeld = notHeldIds(answers);
  if (notHeld.length === 0) {
    return [];
  }
  return [`The challenger answered ${joined(notHeld)} not held, and a practice held by ${heldBy} must be held.`];
}

export function tallyOf(answers: readonly PracticeAnswer[]): Tally {
  const count = (answer: Held): number => answers.filter((practice) => practice.answer === answer).length;
  return { held: count("held"), notHeld: count("not-held"), doesNotApply: count("does-not-apply") };
}

export function tallyWords(who: string, tally: Tally): string {
  const total = tally.held + tally.notHeld + tally.doesNotApply;
  return (
    `practices answered by ${who}: ${String(total)}; ${String(tally.held)} held, ` +
    `${String(tally.notHeld)} not held, ${String(tally.doesNotApply)} do not apply`
  );
}

export function notHeldWords(practice: NotHeld): string {
  const level = practice.level === undefined ? "" : `, ${practice.level}`;
  const says = practice.says === undefined ? "" : ` ${shortened(practice.says, saysShown)}`;
  const place = practice.path === undefined ? "" : ` In ${practice.path}:`;
  return `${practice.id}${level}, not held:${says}${place} ${practice.sentence}`;
}

export function notHeldLine(step: string, practice: NotHeld): CardLine {
  return judged(step, notHeldWords(practice));
}

export function practiceLines(block: PracticeBlock): readonly CardLine[] {
  const notHeld = block.answers.filter((practice) => practice.answer === "not-held");
  return [
    computed("draw", `practices held by the script's checks: ${joined(block.heldByRules)}`),
    computed("draw", tallyWords("the challenger", tallyOf(block.answers))),
    ...notHeld.map((practice) => notHeldLine(block.challenger, { id: practice.id, sentence: practice.sentence })),
  ];
}
