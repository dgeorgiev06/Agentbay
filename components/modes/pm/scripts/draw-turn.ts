import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { flagAt, numberAt, textAt } from "./lib/json.ts";
import { readSources } from "./lib/sources.ts";
import { treeOf } from "./lib/tree.ts";
import { turnCard } from "./lib/turn-card.ts";
import { sourcePaths, turnOf } from "./lib/turn.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const turn = turnOf(fields.turn ?? null);
  return turnCard({
    job: textAt(input, "job"),
    number: numberAt(input, "number"),
    tree: treeOf(fields.tree ?? null),
    turn,
    oneAtATime: flagAt(input, "oneAtATime"),
    sources: await readSources(context, sourcePaths(turn)),
  });
});
