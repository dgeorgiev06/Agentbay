import assert from "node:assert/strict";
import { test } from "node:test";
import { buildsOver, startChoices, stopReason, waveChoices } from "../scripts/lib/start-choices.ts";

const agreed = ["components/modes/r1/schemas/count-request.json"];

const left = [{ branch: "forge/R1-tests-1", commit: "1c9a4e0b7d2f3a5c6e8b9d0f1a2b3c4d5e6f7a8b" }];

test("a slice that names its interface files may be built, and every other go-ahead is withheld with its reason", () => {
  assert.deepEqual(startChoices(agreed, []), {
    offered: {
      build: true,
      "build-without-interface": false,
      "build-over": false,
      "build-over-without-interface": false,
    },
    withheld: {
      "build-without-interface": "The slice names its interface files.",
      "build-over": "No earlier run left a branch of this slice.",
      "build-over-without-interface": "No earlier run left a branch of this slice.",
    },
  });
});

test("a slice that names no interface files may go ahead without one, and the plain build is withheld with its reason", () => {
  assert.deepEqual(startChoices([], []), {
    offered: {
      build: false,
      "build-without-interface": true,
      "build-over": false,
      "build-over-without-interface": false,
    },
    withheld: {
      build: "The slice names no interface files.",
      "build-over": "No earlier run left a branch of this slice.",
      "build-over-without-interface": "No earlier run left a branch of this slice.",
    },
  });
});

test("a branch an earlier run left offers only building over it, with or without an interface as the slice names one", () => {
  const leftSaid = "An earlier run left branches of this slice; build over them or stop.";
  assert.deepEqual(startChoices(agreed, left), {
    offered: {
      build: false,
      "build-without-interface": false,
      "build-over": true,
      "build-over-without-interface": false,
    },
    withheld: {
      build: leftSaid,
      "build-without-interface": leftSaid,
      "build-over-without-interface": "The slice names its interface files.",
    },
  });
  assert.deepEqual(startChoices([], left).offered, {
    build: false,
    "build-without-interface": false,
    "build-over": false,
    "build-over-without-interface": true,
  });
});

test("a wave is built when no earlier run left a branch of it, and built over the branches when one did", () => {
  assert.deepEqual(waveChoices([]), {
    offered: { build: true, "build-over": false },
    withheld: { "build-over": "No earlier run left a branch of this wave." },
  });
  assert.deepEqual(waveChoices(left), {
    offered: { build: false, "build-over": true },
    withheld: { build: "An earlier run left branches of this wave; build over them or stop." },
  });
});

test("stop ends the run with a sentence that says nothing is cut, every go-ahead goes on, and only a build over drops", () => {
  assert.equal(stopReason("stop"), "The owner chose stop on the start card, so nothing is cut.");
  const goAheads = ["build", "build-without-interface", "build-over", "build-over-without-interface"];
  assert.deepEqual(
    goAheads.map((choice) => stopReason(choice)),
    [undefined, undefined, undefined, undefined],
  );
  assert.deepEqual(goAheads.map(buildsOver), [false, false, true, true]);
  assert.equal(buildsOver("stop"), false);
});
