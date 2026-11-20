import assert from "node:assert/strict";
import { test } from "node:test";
import { startChoices, stopReason } from "../scripts/lib/start-choices.ts";

test("a slice that names its interface files may be built, and going ahead without one is withheld with its reason", () => {
  assert.deepEqual(startChoices(["components/modes/r1/schemas/count-request.json"]), {
    offered: { build: true, "build-without-interface": false },
    withheld: { "build-without-interface": "The slice names its interface files." },
  });
});

test("a slice that names no interface files may go ahead without one, and the plain build is withheld with its reason", () => {
  assert.deepEqual(startChoices([]), {
    offered: { build: false, "build-without-interface": true },
    withheld: { build: "The slice names no interface files." },
  });
});

test("stop ends the run with a sentence that says nothing is cut, and either go-ahead goes on", () => {
  assert.equal(stopReason("stop"), "The owner chose stop on the start card, so nothing is cut.");
  assert.equal(stopReason("build"), undefined);
  assert.equal(stopReason("build-without-interface"), undefined);
});
