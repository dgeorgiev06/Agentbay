import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, realpath, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import { listed, openToolchainProject, withoutSeconds } from "./checkouts.ts";

let project: ModeProject;

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const copy = "kit-copy";

const secondsForEachCheckWhenThreeSuitesShareTwoCores = 200;

function kitFiles(): readonly string[] {
  const listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: kit });
  return listing
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "");
}

async function copyKitInto(folder: string): Promise<void> {
  for (const path of kitFiles()) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await cp(join(kit, path), join(folder, path), { force: false, errorOnExist: false });
  }
  await symlink(await realpath(join(kit, "node_modules")), join(folder, "node_modules"));
}

before(async () => {
  project = await openToolchainProject();
  await copyKitInto(join(project.root, copy));
});

after(async () => {
  await project.close();
});

test("check on a copy of the kit itself finds every check passed", async () => {
  const output = await project.output("typescript.check", {
    folder: copy,
    timeLimitSeconds: secondsForEachCheckWhenThreeSuitesShareTwoCores,
  });
  const verdicts = listed(output, "verdicts").map((verdict) => withoutSeconds(verdict));
  assert.deepEqual(
    verdicts.map(({ name, verdict }) => ({ name, verdict })),
    [
      { name: "generate:check", verdict: "passed" },
      { name: "typecheck", verdict: "passed" },
      { name: "lint", verdict: "passed" },
      { name: "format:check", verdict: "passed" },
      { name: "deadcode", verdict: "passed" },
    ],
    JSON.stringify(verdicts, null, 2),
  );
});

test("test on a copy of the kit itself passes two named test files, with their counts", async () => {
  const files = ["tests/version.test.ts", "tests/json.test.ts"];
  const { stdout, stderr, ...result } = withoutSeconds(
    await project.output("typescript.test", { folder: copy, files }),
  );
  const shown = JSON.stringify({ stdout, stderr }, null, 2);
  assert.deepEqual(result, { verdict: "passed", passed: 6, failed: 0, failedTests: [] }, shown);
});
