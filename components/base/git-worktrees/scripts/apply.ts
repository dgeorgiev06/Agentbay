import { fail, type ScriptContext } from "../../../../bay/sdk.ts";
import { madeCopy } from "./lib/folders.ts";
import { firstLine, gitFed, gitSucceeded, nulFields, refuseRepositoryFilters } from "./lib/git.ts";
import { pathsOfPatch } from "./lib/patches.ts";
import { defineRequestScript } from "./lib/request.ts";

const noFilter: readonly string[] = ["unspecified", "unset"];

async function refuseFiltered(context: ScriptContext, folder: string, paths: readonly string[]): Promise<void> {
  const listed = await gitSucceeded(context, folder, ["--work-tree=.", "check-attr", "-z", "filter", "--", ...paths]);
  const fields = nulFields(listed);
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index] ?? "";
    const filter = fields[index + 2] ?? "";
    if (!noFilter.includes(filter)) {
      fail(
        `The path ${path} has the filter ${filter} in the copy's attributes, and git could run that filter's ` +
          "command, so nothing is applied.",
      );
    }
  }
}

export const run = defineRequestScript(async (request, context) => {
  const folder = request.text("folder");
  const patch = request.text("patch");
  const paths = pathsOfPatch(patch);
  await madeCopy(context, folder, "apply a patch to");
  await refuseRepositoryFilters(context, ".");
  await refuseFiltered(context, folder, paths);
  const applied = await gitFed(context, folder, {
    gitArguments: ["--work-tree=.", "apply", "--end-of-options"],
    input: patch,
  });
  if (applied.exitCode !== 0) {
    fail(`The patch does not apply to the copy, so nothing was changed: ${firstLine(applied.stderr)}`);
  }
  return { folder, paths };
});
