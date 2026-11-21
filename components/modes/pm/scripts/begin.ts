import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { askWorkflow, started } from "./lib/interview.ts";
import { textAt } from "./lib/json.ts";
import { readInterview, writeInterview } from "./lib/store.ts";

export const run = defineScript(async (input, context) => {
  const opened = fieldsOf(input).opened ?? null;
  const job = textAt(opened, "job");
  if (textAt(input, "choice") !== "start") {
    return fail(`Nothing was started: the owner chose stop on the card for the interview of ${job}.`);
  }
  const on = context.now().toISOString().slice(0, 10);
  const words = { by: textAt(opened, "by"), on, words: textAt(opened, "words") };
  const interview = started(await readInterview(context, job), job, words);
  await writeInterview(context, interview);
  return {
    job,
    summary: `The interview of ${job} is started; its turn ${String(interview.turn)} comes next.`,
    next: { workflow: askWorkflow, input: { job } },
  };
});
