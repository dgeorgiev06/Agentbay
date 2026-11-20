import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { branchesSaid, droppedOf } from "./lib/branch-endings.ts";
import { builtOver } from "./lib/drops.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { buildsOver, stopReason } from "./lib/start-choices.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const choice = textOf(fields.choice);
  const stopped = stopReason(choice);
  if (stopped !== undefined) {
    return fail(stopped);
  }
  const slices = [...textsOf(fields.slices)];
  if (!buildsOver(choice)) {
    return { choice, slices };
  }
  const leftovers = droppedOf(fields.leftovers).map((left) => left.branch);
  const dropped = await builtOver(context, leftovers, textOf(fields.into));
  return { choice, slices, ...branchesSaid(dropped, []) };
});
