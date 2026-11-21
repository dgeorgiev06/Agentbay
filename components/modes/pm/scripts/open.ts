import { defineScript } from "../../../../bay/sdk.ts";
import { startCard } from "./lib/cards.ts";
import { textAt } from "./lib/json.ts";
import { settingsOf } from "./lib/settings.ts";
import { readInterview } from "./lib/store.ts";

export const run = defineScript(async (input, context) => {
  const job = textAt(input, "job");
  const words = textAt(input, "words");
  const by = textAt(input, "by") === "" ? "owner" : textAt(input, "by");
  const settings = settingsOf(context.settings);
  const before = await readInterview(context, job);
  const drawn = startCard({ job, words, perTurn: settings.perTurn, answers: settings.answers, before });
  return { job, words, by, ...drawn };
});
