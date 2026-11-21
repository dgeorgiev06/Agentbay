import type { Json, ScriptContext } from "../../../../../bay/sdk.ts";
import { listAt } from "./json.ts";

export async function addedFormProblems(context: ScriptContext, turn: Json): Promise<readonly string[]> {
  const added = listAt(turn, "added");
  const checked = await Promise.all(added.map((question) => context.schemas.check("schemas/question.json", question)));
  return checked.flatMap((answer, index) => {
    if (!answer.ok) {
      return [answer.message];
    }
    if (answer.value.passed) {
      return [];
    }
    const said = answer.value.problems.map((problem) => `${problem.path} ${problem.message}`).join("; ");
    return [`The question added at place ${String(index + 1)} is not in the form of a question: ${said}.`];
  });
}
