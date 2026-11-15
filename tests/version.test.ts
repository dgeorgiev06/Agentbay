import { test } from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../bay/version.ts";

test("the kernel reports its version", () => {
  assert.equal(VERSION, "5.0.0-dev");
});
