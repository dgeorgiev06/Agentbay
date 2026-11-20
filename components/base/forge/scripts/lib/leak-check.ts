import type { Json, ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import type { Leak } from "./leaks.ts";
import type { Slice } from "./slice-form.ts";
import { codeAt } from "./code.ts";
import type { HandedTest } from "./handed-tests.ts";
import { leaksFound, phrasesOf, sharedText, type Compared, type SharedText } from "./leaks.ts";
import { textOf } from "./json-values.ts";

export type AfterBuild = {
  readonly slice: Slice;
  readonly cutAs: string;
  readonly round: number;
  readonly base: string;
  readonly commit: string;
  readonly folder: string;
  readonly fixed: readonly string[];
  readonly interface: readonly string[];
  readonly tests: readonly HandedTest[];
  readonly mark: string | undefined;
  readonly answer: Json;
};

async function readable(context: ScriptContext, folder: string, path: string): Promise<readonly HandedTest[]> {
  const read = await context.files.read(`${folder}/${path}`);
  return read.ok ? [{ path, text: read.value }] : [];
}

async function filesAtBase(
  context: ScriptContext,
  asked: AfterBuild,
  paths: readonly string[],
): Promise<readonly HandedTest[]> {
  const name = `${asked.cutAs}-base-${String(asked.round)}`;
  const folder = textOf((await answerOf(context, "worktrees.cut", { slice: name, base: asked.base })).folder);
  const files = await Promise.all(paths.map((path) => readable(context, folder, path)));
  await answerOf(context, "worktrees.remove", { folder, into: asked.base });
  return files.flat();
}

async function sharedSinceBase(
  context: ScriptContext,
  asked: AfterBuild,
  compared: Compared,
): Promise<readonly SharedText[]> {
  const unexcused = sharedText(compared);
  if (unexcused.length === 0) {
    return unexcused;
  }
  const paths = [...asked.interface, ...unexcused.map((file) => file.path)];
  return sharedText({ ...compared, base: await filesAtBase(context, asked, paths) });
}

export async function leaksAfterBuild(context: ScriptContext, asked: AfterBuild): Promise<readonly Leak[]> {
  const { base, commit, folder, fixed } = asked;
  const code = await codeAt(context, { base, commit, folder, fixed });
  const paths = [...code.map((file) => file.path), ...fixed, ...asked.interface];
  const compared: Compared = {
    code,
    tests: asked.tests.map((test) => test.text),
    phrases: phrasesOf(asked.slice, paths),
    interface: asked.interface,
    base: [],
  };
  const shared = await sharedSinceBase(context, asked, compared);
  return leaksFound({ shared, code, mark: asked.mark, answer: asked.answer });
}
