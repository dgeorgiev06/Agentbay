import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { gitSucceeded } from "./git.ts";

export type Made = { readonly kind: "worktree"; readonly branch: string } | { readonly kind: "copy" };

export function worktreeFolder(slice: string): string {
  return `.forge/worktrees/${slice}`;
}

export function copyFolder(name: string): string {
  return `.forge/copies/${name}`;
}

export function targetFolder(into: string): string {
  return `.forge/targets/${into}`;
}

export function sliceBranch(slice: string): string {
  return `forge/${slice}`;
}

export async function madeFolder(context: ScriptContext, folder: string): Promise<Made | undefined> {
  const answer = await context.db.query("select kind, branch from folders where folder = ?", [folder]);
  if (!answer.ok) {
    return fail(answer.message);
  }
  const row = answer.value[0];
  if (row === undefined) {
    return undefined;
  }
  const branch = row.branch;
  if (row.kind === "worktree" && typeof branch === "string") {
    return { kind: "worktree", branch };
  }
  return row.kind === "copy" ? { kind: "copy" } : undefined;
}

export async function folderExists(context: ScriptContext, folder: string): Promise<boolean> {
  const listed = await gitSucceeded(context, ".", ["untracked-paths", folder]);
  return listed === `${folder}/\0`;
}

export function goneSentence(folder: string): string {
  return `The folder ${folder} was made by this mode but no longer exists`;
}

async function refuseGone(context: ScriptContext, folder: string, doing: string): Promise<void> {
  if (!(await folderExists(context, folder))) {
    fail(`${goneSentence(folder)}, so the mode does not ${doing} it.`);
  }
}

export async function madeWorktree(context: ScriptContext, folder: string, doing: string): Promise<string> {
  const made = await madeFolder(context, folder);
  if (made === undefined) {
    return fail(`The folder ${folder} was not made by this mode, so the mode does not ${doing} it.`);
  }
  if (made.kind === "copy") {
    return fail(`The folder ${folder} is a copy, not a worktree, so the mode does not ${doing} it.`);
  }
  await refuseGone(context, folder, doing);
  return made.branch;
}

export async function madeCopy(context: ScriptContext, folder: string, doing: string): Promise<void> {
  const made = await madeFolder(context, folder);
  if (made === undefined) {
    fail(`The folder ${folder} was not made by this mode, so the mode does not ${doing} it.`);
  }
  if (made.kind === "worktree") {
    fail(`The folder ${folder} is a worktree, not a copy, so the mode does not ${doing} it.`);
  }
  await refuseGone(context, folder, doing);
}

async function executed(context: ScriptContext, sql: string, parameters: readonly (string | null)[]): Promise<void> {
  const answer = await context.db.execute(sql, [...parameters]);
  if (!answer.ok) {
    fail(answer.message);
  }
}

export async function recordFolder(context: ScriptContext, folder: string, made: Made): Promise<void> {
  const branch = made.kind === "worktree" ? made.branch : null;
  await executed(context, "insert or replace into folders (folder, kind, branch) values (?, ?, ?)", [
    folder,
    made.kind,
    branch,
  ]);
}

export async function forgetFolder(context: ScriptContext, folder: string): Promise<void> {
  await executed(context, "delete from folders where folder = ?", [folder]);
}
