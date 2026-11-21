import { defineScript } from "../../../../bay/sdk.ts";
import { textAt } from "./lib/json.ts";
import { openingOf } from "./lib/opening.ts";

export const run = defineScript(async (input, context) => {
  const job = textAt(input, "job");
  const words = textAt(input, "words");
  const namedBy = textAt(input, "by") === "" ? "owner" : textAt(input, "by");
  const { card, offered } = await openingOf(context, job, words);
  return { job, words, namedBy, card, offered };
});
