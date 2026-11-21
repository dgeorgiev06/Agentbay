import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { textAt } from "./lib/json.ts";
import { readingOf, readingProblems } from "./lib/reading.ts";
import { turnOf } from "./lib/turn.ts";

export const run = defineScript((input) => {
  const turn = turnOf(fieldsOf(input).turn ?? null);
  const problems = readingProblems(turn, textAt(input, "said"), readingOf(input));
  return Promise.resolve(problems.length === 0 ? { passed: true } : { passed: false, feedback: problems.join(" ") });
});
