import { defineScript, fieldsOf, type ScriptContext } from "../../../../bay/sdk.ts";
import { answerOf } from "./lib/called.ts";
import { textOf } from "./lib/json-values.ts";
import { givenName, leftBy } from "./lib/names-given.ts";

const worktreesFolder = ".forge/worktrees";

async function foldersLeft(context: ScriptContext, earlier: readonly string[]): Promise<readonly string[]> {
  if (earlier.length === 0) {
    return [];
  }
  const listed = await context.files.list(worktreesFolder);
  return listed.ok ? leftBy(earlier, listed.value) : [];
}

async function cleared(context: ScriptContext, name: string): Promise<string> {
  const folder = `${worktreesFolder}/${name}`;
  await answerOf(context, "worktrees.set-aside", { folder });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return folder;
}

export const run = defineScript(async (input, context) => {
  const given = await givenName(context, textOf(fieldsOf(input).wanted));
  const left = await foldersLeft(context, given.earlier);
  const removed: string[] = [];
  for (const name of left) {
    removed.push(await cleared(context, name));
  }
  return { name: given.name, cleared: removed };
});
