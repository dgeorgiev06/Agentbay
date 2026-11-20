import { defineScript, fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { handedTestsOf } from "./lib/handed-tests.ts";
import { refusedReview } from "./lib/review.ts";

function namesOf(value: Json | undefined): readonly string[] {
  const cases = fieldsOf(value ?? null).cases;
  const listed = Array.isArray(cases) ? cases : [];
  return listed.map((entry: Json) => fieldsOf(entry).name).filter((name) => typeof name === "string");
}

function fieldOfEach(value: Json | undefined, key: "id" | "path"): readonly string[] {
  const listed = Array.isArray(value) ? value : [];
  return listed.map((entry: Json) => fieldsOf(entry)[key]).filter((field) => typeof field === "string");
}

export const run = defineScript((input, context) => {
  const asked = fieldsOf(context.skillInput ?? null);
  const refused = refusedReview(input, {
    conditions: sliceOf(asked.slice).done.map((item) => item.id),
    tests: handedTestsOf(context.skillInput ?? null),
    failing: namesOf(asked.failing),
    practices: fieldOfEach(asked.practices, "id"),
    code: fieldOfEach(asked.code, "path"),
  });
  return checkAnswer(refused);
});
