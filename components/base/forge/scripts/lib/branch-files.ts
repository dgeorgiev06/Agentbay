import type { ScriptContext } from "../../../../../bay/sdk.ts";
import type { Stayed } from "./branch-endings.ts";
import { readIn } from "./code.ts";
import { cutAfresh, removedThenDropped } from "./drops.ts";
import type { HandedTest } from "./handed-tests.ts";

export type OnBranch = {
  readonly slice: string;
  readonly branch: string;
  readonly paths: readonly string[];
};

export type ReadOnBranch<Made> = {
  readonly made: Made;
  readonly stayed: readonly Stayed[];
};

export async function whileOnBranch<Made>(
  context: ScriptContext,
  asked: OnBranch,
  use: (files: readonly HandedTest[]) => Promise<Made>,
): Promise<ReadOnBranch<Made>> {
  const cut = await cutAfresh(context, { slice: asked.slice, base: asked.branch }, asked.branch);
  const files = await Promise.all(asked.paths.map((path) => readIn(context, cut.folder, path)));
  const made = await use(files);
  const drops = await removedThenDropped(context, cut, asked.branch);
  return { made, stayed: drops.stayed };
}
