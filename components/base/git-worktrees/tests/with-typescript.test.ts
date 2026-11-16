import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, realpath, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Json } from "../../../../bay/sdk.ts";
import { commitFiles, openRepositoryProject } from "./repository.ts";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

function kitFiles(): readonly string[] {
  const listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: kit });
  return listing
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "");
}

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
    for (const path of kitFiles()) {
      await mkdir(dirname(join(project.root, "kit", path)), { recursive: true });
      await cp(join(kit, path), join(project.root, "kit", path));
    }
    await symlink(await realpath(join(kit, "node_modules")), join(project.root, "kit/node_modules"));
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
