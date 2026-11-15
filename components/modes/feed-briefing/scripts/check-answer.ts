import { defineScript } from "../../../../bay/sdk.ts";
import { called } from "./lib/calls.ts";
import { fieldsOf, textOf, textsOf } from "./lib/json.ts";
import { wordCount } from "./lib/words.ts";

const answerWords = 150;

export const run = defineScript(async (input, context) => {
  const answer = fieldsOf(input);
  const cites = textsOf(answer.cites);
  const problems: string[] = [];
  const words = wordCount(textOf(answer.answer) ?? "");
  if (words > answerWords) {
    problems.push(`The answer has ${String(words)} words; use at most ${String(answerWords)}.`);
  }
  if (cites.length > 0) {
    const missing = textsOf(fieldsOf(await called(context, "items-store.get", { ids: cites })).missing);
    for (const id of missing) {
      problems.push(
        `The answer cites ${id}, which is not in the store; cite only ids that query, get or sql returned.`,
      );
    }
  }
  return problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") };
});
