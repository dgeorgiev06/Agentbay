import { defineScript, fail } from "../../../../bay/sdk.ts";
import { addedFormProblems } from "./lib/added.ts";
import { textAt } from "./lib/json.ts";
import { isOpen } from "./lib/interview.ts";
import { settingsOf } from "./lib/settings.ts";
import { readSources } from "./lib/sources.ts";
import { readInterview } from "./lib/store.ts";
import { sourcePaths, turnOf, turnProblems } from "./lib/turn.ts";

export const run = defineScript(async (output, context) => {
  const job = textAt(context.skillInput ?? null, "job");
  const interview = await readInterview(context, job);
  if (interview === undefined || !isOpen(interview)) {
    return fail(`No turn of the interview of ${job} is open, so no turn can be checked.`);
  }
  const turn = turnOf(output);
  const given = { tree: interview, perTurn: settingsOf(context.settings).perTurn };
  const problems = [
    ...(await addedFormProblems(context, output)),
    ...turnProblems(given, turn, await readSources(context, sourcePaths(turn))),
  ];
  return problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") };
});
