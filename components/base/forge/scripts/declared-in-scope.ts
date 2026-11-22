import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { refusedDeclaration } from "./lib/declared.ts";
import { textsOf } from "./lib/json-values.ts";

export const run = defineScript((input, context) => {
  const asked = fieldsOf(context.skillInput ?? null);
  const slice = sliceOf(asked.slice);
  const refused = refusedDeclaration({
    kind: slice.kind,
    scope: slice.scope,
    fixed: textsOf(asked.fixed),
    interface: textsOf(asked.interface),
    files: textsOf(fieldsOf(input).files),
  });
  return checkAnswer(refused);
});
