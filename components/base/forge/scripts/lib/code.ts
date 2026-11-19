import { fail, fieldsOf, type Json, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { answerOf } from "./called.ts";
import type { HandedTest } from "./handed-tests.ts";

export type CodeAt = {
  readonly base: string;
  readonly commit: string;
  readonly folder: string;
  readonly fixed: readonly string[];
};

const mostCodeFiles = 200;

export async function readIn(context: ScriptContext, folder: string, path: string): Promise<HandedTest> {
  const read = await context.files.read(`${folder}/${path}`);
  return read.ok ? { path, text: read.value } : fail(`forge could not read ${path} in ${folder}: ${read.message}`);
}

function changedPaths(answer: JsonFields): readonly string[] {
  const paths = Array.isArray(answer.paths) ? answer.paths : [];
  const kept = paths.map((entry: Json) => fieldsOf(entry)).filter((entry) => entry.how !== "deleted");
  return kept.map((entry) => (typeof entry.path === "string" ? entry.path : ""));
}

export async function codeAt(context: ScriptContext, at: CodeAt): Promise<readonly HandedTest[]> {
  const changed = changedPaths(await answerOf(context, "worktrees.changed", { from: at.base, to: at.commit }));
  const code = changed.filter((path) => !at.fixed.includes(path)).slice(0, mostCodeFiles);
  return Promise.all(code.map((path) => readIn(context, at.folder, path)));
}
