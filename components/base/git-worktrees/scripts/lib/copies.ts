import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { gitFed, gitSucceeded, nulFields, refuseRepositoryFilters, treeOf } from "./git.ts";

type Changed = Awaited<ReturnType<ScriptContext["files"]["makeFolder"]>>;

type Copy = { readonly folder: string; readonly commit: string };

export async function throwawayChanged(change: Promise<Changed>): Promise<void> {
  const answer = await change;
  if (!answer.ok) {
    fail(answer.message);
  }
}

export async function restoreInto(
  context: ScriptContext,
  copy: Copy & { readonly paths: readonly string[] },
): Promise<void> {
  await gitSucceeded(context, copy.folder, ["restore-paths", copy.commit, "--", ...copy.paths]);
}

export async function refuseUnlessOwnRepository(context: ScriptContext, folder: string): Promise<void> {
  const [prefix, gitFolder, top] = (await gitSucceeded(context, folder, ["repository-top"])).split("\n");
  if (prefix !== "" || top === undefined || gitFolder !== `${top}/.git`) {
    fail(`The copy ${folder} is no longer the top of a repository of its own, so the mode does not change it.`);
  }
  await refuseRepositoryFilters(context, folder);
}

export async function recordInCopy(
  context: ScriptContext,
  change: { readonly folder: string; readonly paths: readonly string[]; readonly message: string },
): Promise<void> {
  const { folder, paths, message } = change;
  await gitSucceeded(context, folder, ["forget-paths", ...paths]);
  const present = nulFields(await gitSucceeded(context, folder, ["untracked-paths", ...paths]));
  if (present.length > 0) {
    await gitSucceeded(context, folder, ["stage-paths", ...present]);
  }
  const committed = await gitFed(context, folder, { call: ["commit-staged"], input: `${message}\n` });
  if (committed.exitCode !== 0) {
    fail(`git commit failed in the copy ${folder}: ${committed.stderr.trim()}`);
  }
}

function exclusionPatch(links: readonly string[]): string {
  return [
    "diff --git a/exclude b/exclude",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/exclude",
    `@@ -0,0 +1,${String(links.length)} @@`,
    ...links.map((link) => `+/${link}`),
    "",
  ].join("\n");
}

async function linkIgnored(context: ScriptContext, folder: string, links: readonly string[]): Promise<void> {
  for (const link of links) {
    await throwawayChanged(context.files.link(`${folder}/${link}`, link));
  }
  if (links.length === 0) {
    return;
  }
  const information = `${folder}/.git/info`;
  await throwawayChanged(context.files.makeFolder(information));
  const ignored = await gitFed(context, information, { call: ["apply-patch"], input: exclusionPatch(links) });
  if (ignored.exitCode !== 0) {
    fail(`git apply could not write the copy's list of ignored links: ${ignored.stderr.trim()}`);
  }
}

export async function makeRepository(
  context: ScriptContext,
  copy: Copy & { readonly links: readonly string[] },
): Promise<void> {
  const { folder, commit, links } = copy;
  await gitSucceeded(context, folder, ["make-repository"]);
  await restoreInto(context, { folder, commit, paths: ["."] });
  await recordInCopy(context, { folder, paths: ["."], message: `A throwaway copy of ${commit}.` });
  const held = await treeOf(context, folder, "HEAD");
  if (held !== (await treeOf(context, ".", commit))) {
    fail(`The copy ${folder} does not hold exactly the files of ${commit}, so it is not to be used; remove it.`);
  }
  await linkIgnored(context, folder, links);
}
