import type { Json, JsonFields, ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { plannerAsked } from "./plan-sources.ts";

export type AskedRound = {
  readonly needed: boolean;
  readonly action: "plan" | "challenge-plan" | "design" | "challenge";
  readonly asked: JsonFields;
  readonly kept: Json;
};

export type SecondRound = {
  readonly needed: boolean;
  readonly action: "plan" | "challenge-plan";
  readonly start: Json;
  readonly adds: JsonFields;
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

export function onlyWhenNeeded(context: ScriptContext, round: SecondRound): Promise<Round> {
  const { needed, action, kept } = round;
  return askedWhenNeeded(context, { needed, action, kept, asked: plannerAsked(round.start, round.adds) });
}
