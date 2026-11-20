import { fail, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { branchesSaid, droppedOf } from "./branch-endings.ts";
import { builtOver } from "./drops.ts";
import { textOf } from "./json-values.ts";
import { buildsOver, stopReason } from "./start-choices.ts";

export async function wentAhead(context: ScriptContext, fields: JsonFields): Promise<JsonFields> {
  const choice = textOf(fields.choice);
  const stopped = stopReason(choice);
  if (stopped !== undefined) {
    return fail(stopped);
  }
  if (!buildsOver(choice)) {
    return { choice };
  }
  const leftovers = droppedOf(fields.leftovers).map((left) => left.branch);
  const dropped = await builtOver(context, leftovers, textOf(fields.into));
  return { choice, ...branchesSaid(dropped, []) };
}
