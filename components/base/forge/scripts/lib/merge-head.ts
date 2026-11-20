import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { cutAfresh } from "./drops.ts";
import { textOf } from "./json-values.ts";

export type ToMerge = {
  readonly cutAs: string;
  readonly head: string;
  readonly into: string;
};

export async function headMerged(context: ScriptContext, asked: ToMerge): Promise<string> {
  const cut = await cutAfresh(context, { slice: `${asked.cutAs}-merge`, base: asked.head }, asked.into);
  const merge = await answerOf(context, "worktrees.merge", { folder: cut.folder, into: asked.into });
  await answerOf(context, "worktrees.remove", { folder: cut.folder, branchAfter: "kept" });
  return textOf(merge.commit);
}
