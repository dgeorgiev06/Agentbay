import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import { checkoutRequestOf } from "../scripts/lib/request.ts";
import {
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

before(async () => {
  project = await openToolchainProject();
  folder = await writeCheckout(project, "limits", {
    "package.json": packageWith({ lint: printing("lint found nothing") }),
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

test("a request with no time limit gives 90 seconds for a check and 420 for the test run, and a given limit is passed through", () => {
  assert.deepEqual(
    [
      checkoutRequestOf({ folder: "checkouts/a" }, "check"),
      checkoutRequestOf({ folder: "checkouts/a" }, "test"),
      checkoutRequestOf({ folder: "checkouts/a", checks: ["lint"], timeLimitSeconds: 7 }, "check"),
      checkoutRequestOf({ folder: "checkouts/a", files: ["tests/a.test.ts"], timeLimitSeconds: 7 }, "test"),
    ],
    [
      { folder: "checkouts/a", names: undefined, timeLimitSeconds: 90 },
      { folder: "checkouts/a", names: undefined, timeLimitSeconds: 420 },
      { folder: "checkouts/a", names: ["lint"], timeLimitSeconds: 7 },
      { folder: "checkouts/a", names: ["tests/a.test.ts"], timeLimitSeconds: 7 },
    ],
  );
});
