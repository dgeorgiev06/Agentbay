import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addMode, baseModeTestRan, copyOfTheKit, failedTests, type ModeTestRun } from "./kit-copy.ts";
import { assay, proofFiles, wrongProofs } from "./made-up-proofs.ts";

const baseFolder = "components/base";

let copy: string;

let ranByMode: Readonly<Record<string, ModeTestRun>>;

function ranFor(name: string): ModeTestRun {
  const ran = ranByMode[name];
  assert.ok(ran !== undefined, name);
  return ran;
}

function caseOf(name: string, statement: string): string {
  return `proof@1, ${name}: ${statement}`;
}

function assertFailsOnly(name: string, statement: string): void {
  const tested = ranFor(name);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [caseOf(name, statement)]);
  assert.match(tested.output, /^# pass 34$/m);
}

before(async () => {
  copy = await copyOfTheKit("proofs");
  await addMode(copy, join(baseFolder, assay), proofFiles(assay, "proves by the interface"));
  for (const [name, variant] of Object.entries(wrongProofs)) {
    await addMode(copy, join(baseFolder, name), proofFiles(name, variant));
  }
  const names = [assay, ...Object.keys(wrongProofs)];
  const ran = await Promise.all(
    names.map(async (name): Promise<readonly [string, ModeTestRun]> => [name, await baseModeTestRan(copy, name)]),
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
  assert.match(tested.output, /^# pass 35$/m);
});

test("a made-up proof that reads an inconclusive check as passed fails the shared test's case on it", () => {
  assertFailsOnly(
    "assay-passes-unknown",
    "checks: inconclusive when one check was stopped at its time limit and the others passed, never passed (V1, K7)",
  );
});

test("a made-up proof that gives the toolchain a worktree fails the shared test's case on copies", () => {
  assertFailsOnly(
    "assay-worktree",
    "the toolchain is given only a folder that the worktrees interface's copy made and that is not yet removed (V4: copy, call, remove)",
  );
});

test("a made-up proof that keeps a copy when the toolchain fails fails the shared test's case on removing copies", () => {
  assertFailsOnly(
    "assay-leaves-copy",
    "every copy is removed: after a pass, after a toolchain call that failed and after a run stopped at its time limit (V4)",
  );
});

test("a made-up proof that passes a bug that survived fails the shared test's case on survivors", () => {
  assertFailsOnly("assay-passes-survivor", "bugs-caught: a bug that survives fails the item and is named (K2)");
});

test("a made-up proof that names a declared path in a detail fails the shared test's case on the builder's text", () => {
  assertFailsOnly(
    "assay-shows-declared",
    "as-declared: a file declared and not changed and one changed and not declared fail the item declared with counts, never the builder's text (V2)",
  );
});

test("a made-up proof that leaves out the two added items when every item is judgement fails the shared test's case on them", () => {
  assertFailsOnly(
    "assay-omits-added",
    "the items scope and declared come after the slice's own items in every result, also when every item of the slice is a judgement item",
  );
});

test("a made-up proof that counts a bug whose patch did not apply as caught fails the shared test's case on it", () => {
  assertFailsOnly(
    "assay-passes-stale-bug",
    "bugs-caught: a bug whose patch does not apply makes the item inconclusive, with a reason that names the bug and says it could not be applied, never passed or failed",
  );
});
