import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { copyKitInto, linkNodeModules, type ModeProject } from "../../../../tests/test-toolbox.ts";
import { listed, openToolchainProject, withoutSeconds } from "./checkouts.ts";

let project: ModeProject;

const copy = "kit-copy";

const secondsForEachCheckWhenThreeSuitesShareTwoCores = 200;

before(async () => {
  project = await openToolchainProject();
  await copyKitInto(join(project.root, copy));
  await linkNodeModules(join(project.root, copy));
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
