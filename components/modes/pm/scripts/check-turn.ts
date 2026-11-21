import { defineScript, fail, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { listAt, textAt } from "./lib/json.ts";
import { isOpen } from "./lib/interview.ts";
import { settingsOf } from "./lib/settings.ts";
import { readSources } from "./lib/sources.ts";
import { readInterview } from "./lib/store.ts";
import { sourcePaths, turnOf, turnProblems } from "./lib/turn.ts";

async function shapeProblems(context: ScriptContext, added: readonly Json[]): Promise<readonly string[]> {
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

export const run = defineScript(async (output, context) => {
  const job = textAt(context.skillInput ?? null, "job");
  const interview = await readInterview(context, job);
  if (interview === undefined || !isOpen(interview)) {
    return fail(`No turn of the interview of ${job} is open, so no turn can be checked.`);
  }
  const turn = turnOf(output);
  const given = { tree: interview, perTurn: settingsOf(context.settings).perTurn };
  const problems = [
    ...(await shapeProblems(context, listAt(output, "added"))),
    ...turnProblems(given, turn, await readSources(context, sourcePaths(turn))),
  ];
  return problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") };
});
