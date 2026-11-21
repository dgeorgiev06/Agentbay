import type { Json, JsonFields, ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";

export type SecondRound = {
  readonly needed: boolean;
  readonly action: "plan" | "challenge-plan" | "design" | "challenge";
  readonly asked: JsonFields;
  readonly kept: Json;
};

export type Round = {
  readonly ran: boolean;
  readonly answer: Json;
};

export async function onlyWhenNeeded(context: ScriptContext, round: SecondRound): Promise<Round> {
  if (!round.needed) {
    return { ran: false, answer: round.kept };
  }
  return { ran: true, answer: await answerOf(context, round.action, round.asked) };
}
