import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { flagAt } from "./lib/json.ts";
import { readSources } from "./lib/sources.ts";
import { treeOf } from "./lib/tree.ts";
import { sourcePaths, turnOf, turnProblems } from "./lib/turn.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const turn = turnOf(fields.turn ?? null);
  const sources = await readSources(context, sourcePaths(turn));
  const problems = turnProblems({
    tree: treeOf(fields.tree ?? null),
    turn,
    oneAtATime: flagAt(input, "oneAtATime"),
    sources,
  });
  return problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") };
});
