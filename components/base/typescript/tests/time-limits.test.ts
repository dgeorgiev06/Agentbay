import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { checkoutRequestOf } from "../scripts/lib/request.ts";

const modeFolder = join(import.meta.dirname, "..");

const toolchainFolder = join(modeFolder, "..", "interfaces", "toolchain");

async function readFrom(file: string): Promise<Json> {
  const read = readYaml(await readFile(file, "utf8"));
  assert.ok(read.ok, file);
  return read.value;
}

function stepLimitOf(actions: Json, action: string): Json | undefined {
  return fieldsOf(fieldsOf(actions)[action] ?? null).scriptTimeLimitSeconds;
}

async function longestAskedOf(request: string): Promise<Json | undefined> {
  const schema = await readFrom(join(toolchainFolder, request));
  const properties = fieldsOf(fieldsOf(schema).properties ?? null);
  return fieldsOf(properties.timeLimitSeconds ?? null).maximum;
}

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

test("check, test and run give their script step the 3600 seconds a request may ask and 30 more to answer", async () => {
  const actions = fieldsOf(await readFrom(join(modeFolder, "mode.yaml"))).actions ?? null;
  const requests = ["check-request.json", "test-request.json", "run-request.json"];
  assert.deepEqual(await Promise.all(requests.map(longestAskedOf)), [3600, 3600, 3600]);
  assert.deepEqual(
    ["check", "test", "run"].map((action) => stepLimitOf(actions, action)),
    [3630, 3630, 3630],
  );
});
