import { fail } from "../../../../bay/sdk.ts";
import { changesIn, isClean } from "./lib/changes.ts";
import { madeWorktree } from "./lib/folders.ts";
import { commitOf, gitSucceeded, nulFields, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

type Commit = { readonly hash: string; readonly subject: string };

function commitOfEntry(entry: string): Commit {
  const space = entry.indexOf(" ");
  if (space < 0) {
    return fail(`git log gave a line the mode cannot read: ${entry}`);
  }
  return { hash: entry.slice(0, space), subject: entry.slice(space + 1) };
}

function commitsOf(output: string): readonly Commit[] {
  return nulFields(output).map(commitOfEntry);
}

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  await madeWorktree(context, folder, "look at");
  const base = await safeCommitOf(context, folder, request.text("base"));
  const head = await commitOf(context, folder, "HEAD");
  const commits = commitsOf(await gitSucceeded(context, folder, ["commits-between", `${base}..${head}`]));
  const changes = await changesIn(context, folder);
  return { head, commits, clean: isClean(changes), changed: changes.changed, untracked: changes.untracked };
});
