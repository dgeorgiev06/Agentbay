import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { textOf, textsOf } from "./lib/json-values.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const cut = await answerOf(context, "worktrees.cut", { slice: textOf(fields.cutAs), base: textOf(fields.base) });
  const folder = textOf(cut.folder);
  const files = await Promise.all(
    textsOf(fields.paths).map(async (path) => {
      const read = await context.files.read(`${folder}/${path}`);
      return read.ok ? { path, text: read.value } : { path };
    }),
  );
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return { commit: textOf(cut.commit), files };
});
