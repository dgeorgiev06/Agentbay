import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { gitSucceeded } from "./git.ts";

type Changed = Awaited<ReturnType<ScriptContext["files"]["makeFolder"]>>;

export async function throwawayChanged(change: Promise<Changed>): Promise<void> {
  const answer = await change;
  if (!answer.ok) {
    fail(answer.message);
  }
}

export async function restoreInto(
  context: ScriptContext,
  copy: { readonly folder: string; readonly commit: string; readonly paths: readonly string[] },
): Promise<void> {
  const restore = ["--work-tree=.", "restore", "--worktree", "--source", copy.commit, "--", ...copy.paths];
  await gitSucceeded(context, copy.folder, restore);
}
