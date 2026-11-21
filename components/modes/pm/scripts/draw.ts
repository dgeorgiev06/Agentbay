import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { itemsOf } from "./lib/cards.ts";
import { textAt } from "./lib/json.ts";
import { isOpen } from "./lib/interview.ts";
import { settingsOf } from "./lib/settings.ts";
import { readSources } from "./lib/sources.ts";
import { readInterview } from "./lib/store.ts";
import { sourcePaths, turnOf } from "./lib/turn.ts";

export const run = defineScript(async (input, context) => {
  const job = textAt(input, "job");
  const interview = await readInterview(context, job);
  if (interview === undefined || !isOpen(interview)) {
    return fail(`No turn of the interview of ${job} is open, so no card can be drawn.`);
  }
  const asked = turnOf(fieldsOf(input).turn ?? null);
  const items = itemsOf({
    job,
    turn: interview.turn,
    tree: interview,
    perTurn: settingsOf(context.settings).perTurn,
    asked,
    sources: await readSources(context, sourcePaths(asked)),
  });
  return { items };
});
