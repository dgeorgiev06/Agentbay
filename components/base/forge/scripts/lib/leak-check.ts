import type { Json, ScriptContext } from "../../../../../bay/sdk.ts";
import type { Stayed } from "./branch-endings.ts";
import { cutAfresh, removedThenDropped } from "./drops.ts";
import type { Leak } from "./leaks.ts";
import type { Slice } from "./slice-form.ts";
import { codeAt } from "./code.ts";
import type { HandedTest } from "./handed-tests.ts";
import { leaksFound, phrasesOf, sharedText, type Compared, type SharedText } from "./leaks.ts";

export type AfterBuild = {
  readonly slice: Slice;
  readonly round: number;
  readonly into: string;
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

export type Checked = {
  readonly leaks: readonly Leak[];
  readonly stayed: readonly Stayed[];
};

type AtBase = {
  readonly files: readonly HandedTest[];
  readonly stayed: readonly Stayed[];
};

type Shared = {
  readonly shared: readonly SharedText[];
  readonly stayed: readonly Stayed[];
};

async function filesAtBase(context: ScriptContext, asked: AfterBuild, paths: readonly string[]): Promise<AtBase> {
  const toCut = { slice: `${asked.slice.name}-base-${String(asked.round)}`, base: asked.base };
  const cut = await cutAfresh(context, toCut, asked.into);
  const files = await Promise.all(paths.map((path) => readable(context, cut.folder, path)));
  const drops = await removedThenDropped(context, cut, asked.into);
  return { files: files.flat(), stayed: drops.stayed };
}

async function sharedSinceBase(context: ScriptContext, asked: AfterBuild, compared: Compared): Promise<Shared> {
  const unexcused = sharedText(compared);
  if (unexcused.length === 0) {
    return { shared: unexcused, stayed: [] };
  }
  const paths = [...asked.interface, ...unexcused.map((file) => file.path)];
  const atBase = await filesAtBase(context, asked, paths);
  return { shared: sharedText({ ...compared, base: atBase.files }), stayed: atBase.stayed };
}

export async function leaksAfterBuild(context: ScriptContext, asked: AfterBuild): Promise<Checked> {
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
  const { shared, stayed } = await sharedSinceBase(context, asked, compared);
  return { leaks: leaksFound({ shared, code, mark: asked.mark, answer: asked.answer }), stayed };
}
