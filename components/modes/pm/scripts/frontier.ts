import { defineScript, fail } from "../../../../bay/sdk.ts";
import { opened, turnRefusal } from "./lib/interview.ts";
import { textAt } from "./lib/json.ts";
import { settingsOf } from "./lib/settings.ts";
import { readInterview, writeInterview } from "./lib/store.ts";
import { frontierOf, hasMoreToAsk, type Question } from "./lib/tree.ts";

function idsOf(questions: readonly Question[]): readonly string[] {
  return questions.map((question) => question.id);
}

export const run = defineScript(async (input, context) => {
  const job = textAt(input, "job");
  const interview = await readInterview(context, job);
  const refusal = turnRefusal(interview, job);
  if (interview === undefined || refusal !== undefined) {
    return fail(refusal ?? "");
  }
  const { perTurn } = settingsOf(context.settings);
  const found = frontierOf(interview, perTurn);
  if (!hasMoreToAsk(found)) {
    return fail(`Nothing is left to ask in the interview of ${job}; the sign-off is not built yet.`);
  }
  const token = await context.random(16);
  if (!token.ok) {
    return fail(token.message);
  }
  await writeInterview(context, opened(interview, token.value));
  return {
    job,
    turn: interview.turn,
    perTurn,
    asked: interview.asked,
    questions: interview.questions,
    asks: idsOf(found.asks),
    lookUp: idsOf(found.lookUp),
    opened: token.value,
  };
});
