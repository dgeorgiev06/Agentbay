import type { Json, JsonFields, ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { notHeldIds, type PracticeAnswer } from "./practice-answers.ts";

export type Found<Finding extends Json> = {
  readonly practices: readonly PracticeAnswer[];
  readonly findings: readonly Finding[];
};

export type AskedRound = {
  readonly needed: boolean;
  readonly action: "plan" | "challenge-plan" | "design" | "challenge";
  readonly asked: JsonFields;
  readonly kept: Json;
};

export type Round = {
  readonly ran: boolean;
  readonly answer: Json;
};

export async function askedWhenNeeded(context: ScriptContext, round: AskedRound): Promise<Round> {
  if (!round.needed) {
    return { ran: false, answer: round.kept };
  }
  return { ran: true, answer: await answerOf(context, round.action, round.asked) };
}

export function secondPassNeeded<Finding extends Json>(found: Found<Finding>): boolean {
  return notHeldIds(found.practices).length > 0 || found.findings.length > 0;
}

export function foundOf<Finding extends Json>(found: Found<Finding>): JsonFields {
  return {
    practices: found.practices.filter((practice) => practice.answer === "not-held").map((each) => ({ ...each })),
    findings: [...found.findings],
  };
}
