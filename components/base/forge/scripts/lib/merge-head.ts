import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { textOf } from "./json-values.ts";

export type ToMerge = {
  readonly cutAs: string;
  readonly head: string;
  readonly into: string;
};

export type HeadMerged = {
  readonly folder: string;
  readonly commit: string;
};

export async function headMerged(context: ScriptContext, asked: ToMerge): Promise<HeadMerged> {
  const cut = await answerOf(context, "worktrees.cut", { slice: `${asked.cutAs}-merge`, base: asked.head });
  const folder = textOf(cut.folder);
  const merge = await answerOf(context, "worktrees.merge", { folder, into: asked.into });
  return { folder, commit: textOf(merge.commit) };
}
