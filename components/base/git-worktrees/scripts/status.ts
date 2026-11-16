import { defineScript, fail } from "../../../../bay/sdk.ts";
import { changesIn } from "./lib/changes.ts";
import { madeWorktree } from "./lib/folders.ts";
import { commitOf, gitSucceeded, refuseRepositoryFilters } from "./lib/git.ts";
import { requestOf } from "./lib/request.ts";

type Commit = { readonly hash: string; readonly subject: string };

function commitOfEntry(entry: string): Commit {
  const space = entry.indexOf(" ");
  if (space < 0) {
    return fail(`git log gave a line the mode cannot read: ${entry}`);
  }
  return { hash: entry.slice(0, space), subject: entry.slice(space + 1) };
}

function commitsOf(output: string): readonly Commit[] {
  return output
    .split("\0")
    .filter((entry) => entry !== "")
    .map(commitOfEntry);
}

export const run = defineScript(async (input, context) => {
  const request = requestOf(input);
  const folder = request.text("folder");
  await madeWorktree(context, folder, "look at");
  await refuseRepositoryFilters(context, folder);
  const base = await commitOf(context, folder, request.text("base"));
  const head = await commitOf(context, folder, "HEAD");
  const log = ["log", "-z", "--reverse", "--no-show-signature", "--no-color", "--format=%H%x20%s", "--end-of-options"];
  const commits = commitsOf(await gitSucceeded(context, folder, [...log, `${base}..${head}`]));
  const { changed, untracked } = await changesIn(context, folder);
  return { head, commits, clean: changed.length === 0 && untracked.length === 0, changed, untracked };
});
