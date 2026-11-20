import { fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { plannerInput } from "./plan-sources.ts";

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

export async function onlyWhenNeeded(context: ScriptContext, round: SecondRound): Promise<Round> {
  if (!round.needed) {
    return { ran: false, answer: round.kept };
  }
  const asked = { ...fieldsOf(plannerInput(round.start)), ...round.adds };
  return { ran: true, answer: await answerOf(context, round.action, asked) };
}
