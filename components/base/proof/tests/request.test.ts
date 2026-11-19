import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { requestOf } from "../scripts/lib/request.ts";

function sliceWith(runs: readonly Json[]): Json {
  return {
    slice: {
      name: "RUNS",
      kind: "mode",
      scope: ["**"],
      after: [],
      done: [{ id: "real", says: "It runs.", level: "must", proof: { kind: "real-thing", runs } }],
    },
    base: "base",
    head: "head",
    declared: { files: [], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  };
}

test("a real-thing run and a declared command written with bay are read as the copy's bay.sh, as before run was added", () => {
  const request = requestOf(sliceWith([{ bay: ["print", "a.txt"], stdout: "a\n", exitCode: 0 }]), {
    sameOutput: [{ name: "sound", bay: ["check"] }],
  });
  assert.deepEqual(request.proven, [
    {
      id: "real",
      proof: {
        kind: "real-thing",
        runs: [{ command: { through: "bay", words: ["print", "a.txt"] }, stdout: "a\n", exitCode: 0 }],
      },
    },
  ]);
  assert.deepEqual(request.sameOutput, [{ name: "sound", command: { through: "bay", words: ["check"] } }]);
});

test("a run and a declared command written with run are read as the project's own command through the toolchain, with their words or none, and each of two runs keeps its own form", () => {
  const request = requestOf(
    sliceWith([
      { run: "demo", stdout: "", exitCode: 0 },
      { bay: ["print", "a.txt"], stdout: "a\n", exitCode: 1 },
    ]),
    { sameOutput: [{ name: "greeting", run: "greet", arguments: ["two words"] }] },
  );
  assert.deepEqual(request.proven, [
    {
      id: "real",
      proof: {
        kind: "real-thing",
        runs: [
          { command: { through: "toolchain", name: "demo", arguments: [] }, stdout: "", exitCode: 0 },
          { command: { through: "bay", words: ["print", "a.txt"] }, stdout: "a\n", exitCode: 1 },
        ],
      },
    },
  ]);
  assert.deepEqual(request.sameOutput, [
    { name: "greeting", command: { through: "toolchain", name: "greet", arguments: ["two words"] } },
  ]);
});
