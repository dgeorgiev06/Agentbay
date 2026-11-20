import { fail, type JsonFields, type ScriptContext } from "../../../../../bay/sdk.ts";
import { branchOf, type Branches, type Dropped, type Stayed } from "./branch-endings.ts";
import { answerOf } from "./called.ts";
import { textOf } from "./json-values.ts";

export type Drops = {
  readonly dropped: readonly Dropped[];
  readonly stayed: readonly Stayed[];
};

export type ToCut = {
  readonly slice: string;
  readonly base: string;
};

const worktreesFolder = ".forge/worktrees";

const noDrops: Drops = { dropped: [], stayed: [] };

export function together(drops: readonly Drops[]): Drops {
  return {
    dropped: drops.flatMap((each) => each.dropped),
    stayed: drops.flatMap((each) => each.stayed),
  };
}

function dropsOf(answer: JsonFields): Drops {
  const branch = textOf(answer.branch);
  if (answer.how === "dropped") {
    return { dropped: [{ branch, commit: textOf(answer.commit) }], stayed: [] };
  }
  if (answer.how === "refused") {
    return { dropped: [], stayed: [{ branch, reason: textOf(answer.reason) }] };
  }
  return noDrops;
}

export async function droppedAll(context: ScriptContext, branches: readonly string[], into: string): Promise<Drops> {
  const drops: Drops[] = [];
  for (const branch of branches) {
    drops.push(dropsOf(await answerOf(context, "worktrees.drop-branch", { branch, into })));
  }
  return together(drops);
}

export function settled(context: ScriptContext, branches: Branches, into: string): Promise<Drops> {
  return droppedAll(context, branches.drop, into);
}

export type Made = {
  readonly folder: string;
  readonly branch: string;
};

export async function removedThenDropped(context: ScriptContext, made: Made, into: string): Promise<Drops> {
  await answerOf(context, "worktrees.remove", { folder: made.folder, branchAfter: "kept" });
  return droppedAll(context, [made.branch], into);
}

async function leftAt(context: ScriptContext, branch: string): Promise<Dropped | undefined> {
  const answer = await answerOf(context, "worktrees.drop-branch", { branch, into: branch });
  const { commit } = answer;
  return answer.how === "refused" && typeof commit === "string" ? { branch, commit } : undefined;
}

export async function leftOver(context: ScriptContext, branches: readonly string[]): Promise<readonly Dropped[]> {
  const found: Dropped[] = [];
  for (const branch of branches) {
    const left = await leftAt(context, branch);
    found.push(...(left === undefined ? [] : [left]));
  }
  return found;
}

async function foldersLeft(context: ScriptContext): Promise<readonly string[]> {
  const listed = await context.files.list(worktreesFolder);
  return listed.ok ? listed.value : [];
}

async function setAsideAndRemoved(context: ScriptContext, name: string): Promise<readonly string[]> {
  const folder = `${worktreesFolder}/${name}`;
  const aside = await answerOf(context, "worktrees.set-aside", { folder });
  await answerOf(context, "worktrees.remove", { folder, branchAfter: "kept" });
  return aside.how === "set-aside" ? [textOf(aside.branch)] : [];
}

async function clearedOver(context: ScriptContext, branches: readonly string[], into: string): Promise<Drops> {
  const folders = await foldersLeft(context);
  const setAside: string[] = [];
  for (const branch of branches) {
    const name = branch.slice(branchOf("").length);
    if (folders.includes(name)) {
      setAside.push(...(await setAsideAndRemoved(context, name)));
    }
  }
  return droppedAll(context, [...branches, ...setAside], into);
}

export type Cut = {
  readonly folder: string;
  readonly branch: string;
  readonly commit: string;
  readonly over: Drops;
};

export async function builtOver(
  context: ScriptContext,
  branches: readonly string[],
  into: string,
): Promise<readonly Dropped[]> {
  const drops = await clearedOver(context, branches, into);
  const [refused] = drops.stayed;
  if (refused !== undefined) {
    return fail(
      `forge could not drop ${refused.branch}, which an earlier run left, so nothing is built over it: ` +
        refused.reason,
    );
  }
  return drops.dropped;
}

export async function cutAfresh(context: ScriptContext, toCut: ToCut, into: string): Promise<Cut> {
  if ((await foldersLeft(context)).includes(toCut.slice)) {
    await answerOf(context, "worktrees.remove", { folder: `${worktreesFolder}/${toCut.slice}`, branchAfter: "kept" });
  }
  const over = await droppedAll(context, [branchOf(toCut.slice)], into);
  const cut = await answerOf(context, "worktrees.cut", { slice: toCut.slice, base: toCut.base });
  return { folder: textOf(cut.folder), branch: textOf(cut.branch), commit: textOf(cut.commit), over };
}

export function intoOf(context: ScriptContext): string {
  return textOf(context.settings.into);
}
