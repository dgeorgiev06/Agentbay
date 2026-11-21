import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { flagAt } from "./lib/json.ts";
import { frontierOf, treeOf, type Question } from "./lib/tree.ts";

function idsOf(questions: readonly Question[]): readonly string[] {
  return questions.map((question) => question.id);
}

export const run = defineScript((input) => {
  const found = frontierOf(treeOf(fieldsOf(input).tree ?? null), flagAt(input, "oneAtATime"));
  return Promise.resolve({
    frontier: idsOf(found.frontier),
    asks: idsOf(found.asks),
    lookUp: idsOf(found.lookUp),
    untalkable: idsOf(found.untalkable),
    settled: found.settled,
    waiting: found.waiting,
    total: found.total,
    problems: found.problems,
  });
});
