import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { textOf } from "./json-values.ts";

export type Written = {
  readonly path: string;
  readonly text: string;
};

export type ToCommit = {
  readonly slice: string;
  readonly into: string;
  readonly files: (folder: string) => Promise<readonly Written[]>;
  readonly message: string;
};

export type Committed = {
  readonly commit: string;
  readonly merged: string;
  readonly files: readonly Written[];
};

async function written(context: ScriptContext, folder: string, files: readonly Written[]): Promise<void> {
  for (const file of files) {
    const answer = await context.files.write(`${folder}/${file.path}`, file.text);
    if (!answer.ok) {
      fail(`forge could not write ${file.path} into ${folder}: ${answer.message}`);
    }
  }
}

export async function committedInto(context: ScriptContext, asked: ToCommit): Promise<Committed> {
  const cut = await answerOf(context, "worktrees.cut", { slice: asked.slice, base: asked.into });
  const folder = textOf(cut.folder);
  const files = await asked.files(folder);
  await written(context, folder, files);
  const commit = await answerOf(context, "worktrees.commit", { folder, message: asked.message });
  const merge = await answerOf(context, "worktrees.merge", { folder, into: asked.into });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return { commit: textOf(commit.commit), merged: textOf(merge.commit), files };
}
