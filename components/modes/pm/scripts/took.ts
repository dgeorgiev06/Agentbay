import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { stopped } from "./lib/interview.ts";
import { numberAt, textAt } from "./lib/json.ts";
import { readInterview, writeInterview } from "./lib/store.ts";

export const run = defineScript(async (input, context) => {
  const item = fieldsOf(input).item ?? null;
  const job = textAt(item, "job");
  const choice = textAt(input, "choice");
  if (choice !== "stop") {
    return { id: textAt(item, "id"), choice };
  }
  const interview = await readInterview(context, job);
  if (interview !== undefined) {
    await writeInterview(context, stopped(interview));
  }
  return fail(
    `The owner stopped the interview of ${job} at turn ${String(numberAt(item, "turn"))}; ` +
      "nothing of this turn is kept, and what was settled before stays.",
  );
});
