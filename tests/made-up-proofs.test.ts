import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  addMode,
  assertFailsOnlyTheChosenCases,
  copyOfTheKit,
  failedTests,
  modeTestFile,
  modeTestRan,
  type Cases,
  type ModeTestRun,
} from "./kit-copy.ts";
import { assay, proofFiles, wrongProofs } from "./made-up-proofs.ts";

const baseFolder = "components/base";

const caseThatCatches: Readonly<Record<string, string>> = {
  "assay-passes-unknown":
    "checks: inconclusive when one check was stopped at its time limit and the others passed, never passed (V1, K7)",
  "assay-worktree":
    "the toolchain is given only a folder that the worktrees interface's copy made and that is not yet removed (V4: copy, call, remove)",
  "assay-leaves-copy":
    "every copy is removed: after a pass, after a toolchain call that failed and after a run stopped at its time limit (V4)",
  "assay-passes-survivor": "bugs-caught: a bug that survives fails the item and is named (K2)",
  "assay-shows-declared":
    "as-declared: a file declared and not changed and one changed and not declared fail the item declared with counts, never the builder's text (V2)",
  "assay-omits-added":
    "the items scope and declared come after the slice's own items in every result, also when every item of the slice is a judgement item",
  "assay-passes-stale-bug":
    "bugs-caught: a bug whose patch does not apply makes the item inconclusive, with a reason that names the bug and says it could not be applied, never passed or failed",
  "assay-passes-unloaded-bug":
    "bugs-caught: a bug whose covering test files did not load and that failed no case is inconclusive, with a reason that names it and says its tests did not run, never caught",
};

let copy: string;

let ranByMode: Readonly<Record<string, ModeTestRun>>;

function ranFor(name: string): ModeTestRun {
  const ran = ranByMode[name];
  assert.ok(ran !== undefined, name);
  return ran;
}

function catchingCaseOf(name: string): string {
  const statement = caseThatCatches[name];
  assert.ok(statement !== undefined, `no case is named to catch ${name}`);
  return `proof@1, ${name}: ${statement}`;
}

function casesFor(name: string): Cases {
  return name === assay ? "every case" : { only: [catchingCaseOf(name)] };
}

function assertCaught(name: string): void {
  assertFailsOnlyTheChosenCases(ranFor(name), [catchingCaseOf(name)]);
}

before(async () => {
  assert.deepEqual(Object.keys(caseThatCatches).sort(), Object.keys(wrongProofs).sort());
  copy = await copyOfTheKit("proofs");
  await addMode(copy, join(baseFolder, assay), proofFiles(assay, "proves by the interface"));
  for (const [name, variant] of Object.entries(wrongProofs)) {
    await addMode(copy, join(baseFolder, name), proofFiles(name, variant));
  }
  const names = [assay, ...Object.keys(wrongProofs)];
  const ran = await Promise.all(
    names.map(async (name): Promise<readonly [string, ModeTestRun]> => [
      name,
      await modeTestRan(copy, modeTestFile(baseFolder, name), casesFor(name)),
    ]),
  );
  ranByMode = Object.fromEntries(ran);
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("a made-up proof that reaches code only through the toolchain and worktrees interfaces passes proof@1's shared test", () => {
  const tested = ranFor(assay);
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.match(tested.output, /^# pass 44$/m);
});

test("a made-up proof that reads an inconclusive check as passed fails the shared test's case on it", () => {
  assertCaught("assay-passes-unknown");
});

test("a made-up proof that gives the toolchain a worktree fails the shared test's case on copies", () => {
  assertCaught("assay-worktree");
});

test("a made-up proof that keeps a copy when the toolchain fails fails the shared test's case on removing copies", () => {
  assertCaught("assay-leaves-copy");
});

test("a made-up proof that passes a bug that survived fails the shared test's case on survivors", () => {
  assertCaught("assay-passes-survivor");
});

test("a made-up proof that names a declared path in a detail fails the shared test's case on the builder's text", () => {
  assertCaught("assay-shows-declared");
});

test("a made-up proof that leaves out the two added items when every item is judgement fails the shared test's case on them", () => {
  assertCaught("assay-omits-added");
});

test("a made-up proof that counts a bug whose patch did not apply as caught fails the shared test's case on it", () => {
  assertCaught("assay-passes-stale-bug");
});

test("a made-up proof that counts a bug whose tests did not load as caught fails the shared test's case on it", () => {
  assertCaught("assay-passes-unloaded-bug");
});
