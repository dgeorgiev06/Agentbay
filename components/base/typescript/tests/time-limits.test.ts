import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutRequestOf } from "../scripts/lib/request.ts";

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
