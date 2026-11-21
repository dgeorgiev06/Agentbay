import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { addedFormProblems } from "./lib/added.ts";
import { answerOf, answerProblems, recorded } from "./lib/answers.ts";
import { isOpen } from "./lib/interview.ts";
import { listAt, textAt } from "./lib/json.ts";
import { settingsOf } from "./lib/settings.ts";
import { readSources } from "./lib/sources.ts";
import { readInterview, writeInterview } from "./lib/store.ts";
import { keptSummary } from "./lib/summary.ts";
import { sourcePaths, turnOf, turnProblems } from "./lib/turn.ts";

export const run = defineScript(async (input, context) => {
  const job = textAt(input, "job");
  const interview = await readInterview(context, job);
  if (interview === undefined || !isOpen(interview)) {
    return fail(`No turn of the interview of ${job} is open, so nothing can be kept.`);
  }
  if (interview.openTurn !== textAt(input, "opened")) {
    return fail(`Nothing is kept: the turn handed to record is not the turn of the interview of ${job} that is open.`);
  }
  const turn = turnOf(fieldsOf(input).turn ?? null);
  const answers = listAt(input, "answers").map(answerOf);
  const { perTurn } = settingsOf(context.settings);
  const problems = [
    ...(await addedFormProblems(context, fieldsOf(input).turn ?? null)),
    ...turnProblems({ tree: interview, perTurn }, turn, await readSources(context, sourcePaths(turn))),
    ...answerProblems(turn, answers),
  ];
  if (problems.length > 0) {
    return fail(`Nothing of turn ${String(interview.turn)} of the interview of ${job} is kept: ${problems.join(" ")}`);
  }
  const after = recorded(interview, turn, answers);
  await writeInterview(context, after);
  return { job, summary: keptSummary(interview, after, perTurn) };
});
