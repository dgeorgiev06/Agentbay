import { canonicalJson, defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { started } from "./lib/interview.ts";
import { textAt } from "./lib/json.ts";
import { openingOf } from "./lib/opening.ts";
import { writeInterview } from "./lib/store.ts";
import { startedSummary } from "./lib/summary.ts";

export const run = defineScript(async (input, context) => {
  const opened = fieldsOf(input).opened ?? null;
  const job = textAt(opened, "job");
  if (textAt(input, "choice") !== "start") {
    return fail(`Nothing was started: the owner chose stop on the card for the interview of ${job}.`);
  }
  const words = textAt(opened, "words");
  const now = await openingOf(context, job, words);
  if (!now.offered.start) {
    return fail(`Nothing was started: the start card for the interview of ${job} does not offer start now.`);
  }
  if (canonicalJson(now.card) !== canonicalJson(fieldsOf(opened).card ?? null)) {
    return fail(
      `Nothing was started: the card begin was given is not the start card for the interview of ${job} as it stands.`,
    );
  }
  const on = context.now().toISOString().slice(0, 10);
  const interview = started(now.before, job, { namedBy: textAt(opened, "namedBy"), on, words });
  await writeInterview(context, interview);
  return { job, summary: startedSummary(interview) };
});
