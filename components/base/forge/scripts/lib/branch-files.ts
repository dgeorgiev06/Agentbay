import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import { readIn } from "./code.ts";
import type { HandedTest } from "./handed-tests.ts";
import { textOf } from "./json-values.ts";

export type OnBranch = {
  readonly slice: string;
  readonly branch: string;
  readonly paths: readonly string[];
};

export async function whileOnBranch<Made>(
  context: ScriptContext,
  asked: OnBranch,
  use: (files: readonly HandedTest[]) => Promise<Made>,
): Promise<Made> {
  const cut = await answerOf(context, "worktrees.cut", { slice: asked.slice, base: asked.branch });
  const folder = textOf(cut.folder);
  const files = await Promise.all(asked.paths.map((path) => readIn(context, folder, path)));
  const made = await use(files);
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "deleted", into: asked.branch });
  return made;
}
