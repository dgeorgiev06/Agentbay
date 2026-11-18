import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const lint = new ESLint({ cwd: kit, overrideConfigFile: "components/base/typescript/eslint.config.js" });

const ignoredByTheKit = "tests/fixtures/";

function kitCodeFiles(): readonly string[] {
  const listing = execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.js"], { cwd: kit });
  return listing
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "" && !path.startsWith(ignoredByTheKit));
}

async function ignored(paths: readonly string[]): Promise<readonly string[]> {
  const found: string[] = [];
  for (const path of paths) {
    if (await lint.isPathIgnored(path)) {
      found.push(path);
    }
  }
  return found;
}

test("lint does not read a slice's worktree or a throwaway copy under .forge/", async () => {
  const forgeFiles = [".forge/worktrees/TR2/tests/broken.test.ts", ".forge/copies/proof-1-1/bay/sdk.ts"];
  assert.deepEqual(await ignored(forgeFiles), forgeFiles);
});

test("lint reads every TypeScript and JavaScript file the kit holds, but its fixtures", async () => {
  const files = kitCodeFiles();
  assert.ok(files.length > 100, String(files.length));
  assert.deepEqual(await ignored(files), []);
});
