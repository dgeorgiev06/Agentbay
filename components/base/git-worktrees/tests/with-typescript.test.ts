import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { copyKitInto, linkNodeModules } from "../../../../tests/test-toolbox.ts";
import { commitFiles, openRepositoryProject } from "./repository.ts";

type Fields = { readonly [key: string]: Json };

function isFields(value: Json | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function namedVerdicts(output: Json): readonly Json[] {
  const verdicts = isFields(output) ? output.verdicts : undefined;
  assert.ok(isList(verdicts), JSON.stringify(output));
  return verdicts.map((verdict) =>
    isFields(verdict) ? { name: verdict.name ?? null, verdict: verdict.verdict ?? null } : verdict,
  );
}

test("a copy of a commit of the kit, with node_modules linked, passes the TypeScript mode's type check", async () => {
  const project = await openRepositoryProject(["git-worktrees", "typescript"]);
  try {
    await copyKitInto(join(project.root, "kit"));
    await linkNodeModules(join(project.root, "kit"));
    const ignored = { ".gitignore": ".agentbay/\n.forge/\nnode_modules\n" };
    const commit = await commitFiles(project, { files: ignored, message: "Add a copy of the kit" });
    const copy = await project.output("git-worktrees.copy", { commit, name: "kit", links: ["kit/node_modules"] });
    assert.deepEqual(copy, { folder: ".forge/copies/kit" });
    const started = Date.now();
    const output = await project.output("typescript.check", { folder: ".forge/copies/kit/kit", checks: ["typecheck"] });
    assert.deepEqual(
      namedVerdicts(output),
      [{ name: "typecheck", verdict: "passed" }],
      JSON.stringify(output, null, 2),
    );
    process.stdout.write(`# typecheck on the copy took ${String(Date.now() - started)} ms\n`);
  } finally {
    await project.close();
  }
});
