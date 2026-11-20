import { defineScript, fail, fieldsOf } from "../../../../bay/sdk.ts";
import { filteredProof } from "./lib/failing.ts";
import { forgetKept, keptTests } from "./lib/kept-tests.ts";
import { sliceOf } from "./lib/slice-form.ts";

export const run = defineScript(async (input, context) => {
  const name = sliceOf(fieldsOf(input).slice).name;
  const tests = await keptTests(context, name);
  const answer = await context.call("proof.prove", input);
  await forgetKept(context, name);
  return answer.ok ? filteredProof(answer.value, tests) : fail(answer.message);
});
