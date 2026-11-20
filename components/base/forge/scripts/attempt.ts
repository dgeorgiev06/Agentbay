import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { branchesSaid, roundsBranches } from "./lib/branch-endings.ts";
import { builtOver, intoOf } from "./lib/drops.ts";
import { textOf } from "./lib/json-values.ts";
import { lastRound } from "./lib/rounds.ts";

export const run = defineScript(async (input, context) => {
  const slice = textOf(fieldsOf(input).slice);
  const dropped = await builtOver(context, roundsBranches(slice, lastRound), intoOf(context));
  return branchesSaid(dropped, []);
});
