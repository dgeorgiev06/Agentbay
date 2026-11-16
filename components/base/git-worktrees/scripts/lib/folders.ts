import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";

export type Made = { readonly kind: "worktree"; readonly branch: string } | { readonly kind: "copy" };

export function worktreeFolder(slice: string): string {
  return `.forge/worktrees/${slice}`;
}

export function sliceBranch(slice: string): string {
  return `forge/${slice}`;
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
