import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  hanging,
  listed,
  npmHeader,
  openToolchainProject,
  packageWith,
  printing,
  withoutSeconds,
  writeCheckout,
} from "./checkouts.ts";

let project: ModeProject;

let folder: string;

const hangingTest = [
  'import { test } from "node:test";',
  'test("waits for ever", () => new Promise((done) => setTimeout(done, 600000)));',
  "",
].join("\n");

before(async () => {
  project = await openToolchainProject();
  folder = await writeCheckout(project, "limits", {
    "package.json": packageWith({ typecheck: hanging, lint: printing("lint found nothing"), test: "node --test" }),
    "tests/waits.test.ts": hangingTest,
  });
});

after(async () => {
  await project.close();
});

const refused = "input.timeLimitSeconds is not valid (must be <= 420).";

test("check and test accept a time limit of 420 seconds and refuse 421 with the schema's sentence", async () => {
  const lint = await project.output("typescript.check", { folder, checks: ["lint"], timeLimitSeconds: 420 });
  assert.deepEqual(
    listed(lint, "verdicts").map((verdict) => withoutSeconds(verdict)),
    [
      {
        name: "lint",
        verdict: "passed",
        stdout: `${npmHeader("lint", printing("lint found nothing"))}lint found nothing\n`,
        stderr: "",
      },
    ],
  );
  assert.equal(await project.refusal("typescript.check", { folder, timeLimitSeconds: 421 }), refused);
  assert.equal(await project.refusal("typescript.test", { folder, timeLimitSeconds: 421 }), refused);
});

test("left out, a check may take 90 seconds and a test run 420", async () => {
  const [check, run] = await Promise.all([
    project.output("typescript.check", { folder, checks: ["typecheck"] }),
    project.output("typescript.test", { folder }),
  ]);
  const [typecheck] = listed(check, "verdicts").map((verdict) => withoutSeconds(verdict));
  assert.deepEqual(
    { check: typecheck?.reason ?? null, test: withoutSeconds(run).reason ?? null },
    {
      check: "typecheck did not finish within 90 seconds and was stopped.",
      test: "The test run did not finish within 420 seconds and was stopped.",
    },
  );
});
