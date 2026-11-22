import { join } from "node:path/posix";
import { defineScript, fieldsOf, type ScriptContext } from "../../../../bay/sdk.ts";
import { sliceOf } from "./lib/slice-form.ts";
import { checkAnswer } from "./lib/check-answer.ts";
import { modeFoldersOf, refusedDeclaration } from "./lib/declared.ts";
import { textOf, textsOf } from "./lib/json-values.ts";

async function testsIn(context: ScriptContext, worktree: string, modeFolder: string): Promise<readonly string[]> {
  const tests = join(modeFolder, "tests");
  const listed = await context.files.list(join(worktree, tests));
  return listed.ok ? listed.value.map((name) => join(tests, name)) : [];
}

export const run = defineScript(async (input, context) => {
  const asked = fieldsOf(context.skillInput ?? null);
  const slice = sliceOf(asked.slice);
  const files = textsOf(fieldsOf(input).files);
  const worktree = textOf(asked.folder);
  const existing = await Promise.all(modeFoldersOf(files).map((folder) => testsIn(context, worktree, folder)));
  const refused = refusedDeclaration({
    kind: slice.kind,
    scope: slice.scope,
    fixed: textsOf(asked.fixed),
    interface: textsOf(asked.interface),
    files,
    existing: existing.flat(),
  });
  return checkAnswer(refused);
});
