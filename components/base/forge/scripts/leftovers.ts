import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { roundsBranches } from "./lib/branch-endings.ts";
import { leftOver } from "./lib/drops.ts";
import { textOf } from "./lib/json-values.ts";
import { lastRound } from "./lib/rounds.ts";

export const run = defineScript(async (input, context) => {
  const request = fieldsOf(fieldsOf(input).request ?? null);
  const name = textOf(fieldsOf(fieldsOf(request.planned ?? null).slice ?? null).name);
  return { leftovers: [...(await leftOver(context, roundsBranches(name, lastRound)))] };
});
