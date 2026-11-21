import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { answerOf, answerProblems, recorded } from "./lib/answers.ts";
import { askWorkflow } from "./lib/interview.ts";
import { listAt, textAt } from "./lib/json.ts";
import { settingsOf } from "./lib/settings.ts";
import { readSources } from "./lib/sources.ts";
import { readInterview, writeInterview } from "./lib/store.ts";
import { keptSummary } from "./lib/summary.ts";
import { sourcePaths, turnOf, turnProblems } from "./lib/turn.ts";

export const run = defineScript(async (input, context) => {
  const job = textAt(input, "job");
  const interview = await readInterview(context, job);
  if (interview === undefined || !interview.open) {
    return fail(`No turn of the interview of ${job} is open, so nothing can be kept.`);
  }
  const turn = turnOf(fieldsOf(input).turn ?? null);
  const answers = listAt(input, "answers").map(answerOf);
  const { perTurn } = settingsOf(context.settings);
  const problems = [
    ...turnProblems({ tree: interview, perTurn }, turn, await readSources(context, sourcePaths(turn))),
    ...answerProblems(turn, answers),
  ];
  if (problems.length > 0) {
    return fail(`Nothing of turn ${String(interview.turn)} of the interview of ${job} is kept: ${problems.join(" ")}`);
  }
  const after = recorded(interview, turn, answers);
  await writeInterview(context, after);
  const kept = keptSummary(interview, after, perTurn);
  return kept.more
    ? { job, summary: kept.summary, next: { workflow: askWorkflow, input: { job } } }
    : { job, summary: kept.summary };
});
