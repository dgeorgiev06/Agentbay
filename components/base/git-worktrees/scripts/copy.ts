import { fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { makeRepository, throwawayChanged } from "./lib/copies.ts";
import { copyFolder, madeFolder, recordFolder } from "./lib/folders.ts";
import { git, safeCommitOf } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

async function refuseUnignored(context: ScriptContext, links: readonly string[]): Promise<void> {
  for (const link of links) {
    const checked = await git(context, ".", ["is-ignored", link]);
    if (checked.exitCode === 1) {
      fail(`The path ${link} is not ignored by git in the project, so the copy does not link to it.`);
    }
    if (checked.exitCode !== 0) {
      fail(`git check-ignore failed on ${link}: ${checked.stderr.trim()}`);
    }
  }
}

export const run = defineRequestScript(async (request, context) => {
  const name = request.text("name");
  const links = request.texts("links");
  const folder = copyFolder(name);
  if ((await madeFolder(context, folder)) !== undefined) {
    fail(`The name ${name} is already in use by the copy ${folder}.`);
  }
  await refuseUnignored(context, links);
  const commit = await safeCommitOf(context, ".", request.text("commit"));
  await throwawayChanged(context.files.makeFolder(folder));
  await recordFolder(context, folder, { kind: "copy" });
  await makeRepository(context, { folder, commit, links });
  return { folder };
});
