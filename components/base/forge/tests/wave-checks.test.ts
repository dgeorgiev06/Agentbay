import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf } from "../../../../bay/sdk.ts";
import { provedOf, type Proved } from "../scripts/lib/proof-answer.ts";
import { sliceOf, type Slice } from "../scripts/lib/slice-form.ts";
import { aloneWords, checksVerdict, waveAnswer, type Joined } from "../scripts/lib/wave-answer.ts";
import { ownProofReason } from "../scripts/lib/wave-standing.ts";
import { checksFailed, checksPassed, ownPassed, plannedSlice } from "./wave-run.ts";

const head = "3710c98d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b";

function checksSlice(ids: readonly string[]): Slice {
  const done = ids.map((id) => ({ id, says: "The checks pass.", level: "must", proof: { kind: "checks" } }));
  return sliceOf({ name: "wave-1", kind: "mode", scope: [], after: [], done });
}

function proofOf(verdicts: readonly Proved["verdicts"][number][]): Proved {
  return { verdicts, size: [] };
}

const passed = (item: string): Proved["verdicts"][number] => ({ item, kind: "checks", verdict: "passed", detail: "x" });

const failed = (item: string): Proved["verdicts"][number] => ({ item, kind: "checks", verdict: "failed", detail: "x" });

describe("a checks verdict is passed only when every checks item has a passed verdict", () => {
  test("no checks items at all is not known, and merge is withheld as not known", () => {
    const checked = { slice: checksSlice([]), proof: proofOf([]) };
    assert.equal(checksVerdict(checked), "not known");
    const joined: Joined = { kind: "combined", head, branch: "forge/wave-1", merged: [] };
    const answer = waveAnswer([], joined, { checks: { kind: "asked", ...checked } });
    assert.equal(answer.offered, false);
    assert.equal(answer.reason, "the wave's checks are not known.");
  });

  test("verdicts only for other items are not known", () => {
    assert.equal(checksVerdict({ slice: checksSlice(["checks"]), proof: proofOf([passed("scope")]) }), "not known");
  });

  test("one item passed and one with no verdict is not known; one failed among passed is failed", () => {
    const two = checksSlice(["checks", "more-checks"]);
    assert.equal(checksVerdict({ slice: two, proof: proofOf([passed("checks")]) }), "not known");
    assert.equal(checksVerdict({ slice: two, proof: proofOf([passed("checks"), failed("more-checks")]) }), "failed");
    assert.equal(checksVerdict({ slice: two, proof: proofOf([passed("checks"), passed("more-checks")]) }), "passed");
  });

  test("a slice proved alone with no checks items, or no verdict, is not known alone, never passing", () => {
    const empty = { name: "CB", slice: checksSlice([]), proof: proofOf([]) };
    const silent = { name: "CC", slice: checksSlice(["DOD-CC-2"]), proof: proofOf([]) };
    const fine = { name: "CA", slice: checksSlice(["DOD-CA-2"]), proof: provedOf(checksPassed("DOD-CA-2")) };
    assert.deepEqual(aloneWords([fine, empty, silent]), ["not known alone: CB and CC"]);
    const breaking = { name: "CD", slice: checksSlice(["DOD-CD-2"]), proof: provedOf(checksFailed("DOD-CD-2", "x")) };
    assert.deepEqual(aloneWords([empty, breaking]), [
      "CD fails the checks alone, so its work breaks the suite",
      "not known alone: CB",
    ]);
  });
});

describe("a slice whose own proof gave no verdict for a must item is left out", () => {
  test("the must item with no verdict is not known, so the slice stays out of the combined head", () => {
    const slice = sliceOf(fieldsOf(plannedSlice("TD1")).slice);
    const own = { ...slice, done: slice.done.filter((item) => item.proof?.kind !== "checks") };
    const state = {
      round: 1,
      stage: "reviewed" as const,
      done: true,
      base: head,
      built: { outcome: "built" as const },
      builder: { branch: "forge/TD1", commit: head },
      head,
      branch: "forge/TD1-tests-1",
      declared: null,
      tests: [],
      verdicts: [],
      failing: { items: [], cases: [], withheld: 0, notListed: 0, notLoaded: [] },
      toBuilder: [],
      toTests: 0,
      conditions: [],
      remaining: [],
      leaks: [],
    };
    const pins = { base: [], head: [] };
    const withoutOwnItem = proofOf(
      provedOf(ownPassed("TD1")).verdicts.filter((verdict) => verdict.item !== "DOD-TD1-1"),
    );
    assert.equal(ownProofReason({ own, proof: withoutOwnItem, state, pins, must: [] }), "1 must item is not known.");
    assert.equal(ownProofReason({ own, proof: proofOf([]), state, pins, must: [] }), "1 must item is not known.");
  });
});
