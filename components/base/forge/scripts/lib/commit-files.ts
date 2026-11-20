import { fail, fieldsOf, type ScriptContext } from "../../../../../bay/sdk.ts";
import { branchesAfter, type Dropped, type Stayed } from "./branch-endings.ts";
import { answerOf } from "./called.ts";
import { cutAfresh, settled, together } from "./drops.ts";
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
  readonly dropped: readonly Dropped[];
  readonly stayed: readonly Stayed[];
};

async function written(context: ScriptContext, folder: string, files: readonly Written[]): Promise<void> {
  for (const file of files) {
    const answer = await context.files.write(`${folder}/${file.path}`, file.text);
    if (!answer.ok) {
      fail(`forge could not write ${file.path} into ${folder}: ${answer.message}`);
    }
  }
}

function notLanded(at: { branch: string; commit: string; into: string }, why: string): never {
  return fail(
    `forge committed the work as ${at.commit} on ${at.branch}, but it did not land in ${at.into}, so the branch ` +
      `stays and holds it: ${why}`,
  );
}

export async function committedInto(context: ScriptContext, asked: ToCommit): Promise<Committed> {
  const { into } = asked;
  const cut = await cutAfresh(context, { slice: asked.slice, base: into }, into);
  const files = await asked.files(cut.folder);
  await written(context, cut.folder, files);
  const made = await answerOf(context, "worktrees.commit", { folder: cut.folder, message: asked.message });
  const commit = textOf(made.commit);
  const merge = await context.call("worktrees.merge", { folder: cut.folder, into });
  await answerOf(context, "worktrees.remove", { folder: cut.folder, branchAfter: "kept" });
  const ending = { kind: "committed", name: asked.slice, landed: merge.ok } as const;
  const drops = together([cut.over, await settled(context, branchesAfter(ending), into)]);
  if (!merge.ok) {
    return notLanded({ branch: cut.branch, commit, into }, merge.message);
  }
  const merged = textOf(fieldsOf(merge.value).commit);
  return { commit, merged, files, dropped: cut.over.dropped, stayed: drops.stayed };
}
