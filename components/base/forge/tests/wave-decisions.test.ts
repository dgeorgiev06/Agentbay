import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { planOf } from "../scripts/lib/plan-form.ts";
import { workOut } from "../scripts/lib/plan-waves.ts";
import { sideBySideOf } from "../scripts/lib/side-by-side.ts";
import { proving, waveProofRequest, type ToJoin } from "../scripts/lib/wave-join.ts";
import { nameClashes, testsToLookFor, waveOf, type PlanFound } from "../scripts/lib/wave-plan.ts";
import { modelCallsOfASlice } from "../scripts/lib/wave-start-card.ts";
import { agreed, plannedSlice, testPath } from "./wave-run.ts";

const base = "875d936a1b2c3d4e5f60718293a4b5c6d7e8f901";

const asked = { plan: "docs/plans/0099-wave.yaml", wave: 1, into: "integration" };

function planned(name: string, changes: Readonly<Record<string, Json>> = {}): Json {
  const entry = fieldsOf(plannedSlice(name));
  return { ...entry, slice: { ...fieldsOf(entry.slice ?? null), ...changes } };
}

function found(slices: readonly Json[], extra: Readonly<Record<string, Json>> = {}): PlanFound {
  const document = { title: "A wave", slices: [...slices], ...extra };
  const plan = planOf(document);
  return { plan, document, workedOut: workOut(plan, []) };
}

const at = { base, present: [], name: "wave-1" };

describe("which slices a wave holds, and their requests", () => {
  test("a wave holds the slices forge.waves puts in it, each requested at the head of into", () => {
    const later = planned("TD2", { after: [{ slice: "TD1", because: "It adds to TD1's mode." }] });
    const wave = waveOf(asked, found([planned("TD1"), planned("TD10"), later]), at);
    assert.ok(wave.kind === "wave");
    assert.deepEqual(
      wave.slices.map((slice) => slice.name),
      ["TD1", "TD10"],
    );
    assert.equal(wave.waves, 2);
    assert.deepEqual(
      wave.requests.map((request) => fieldsOf(request).base),
      [base, base],
    );
    assert.deepEqual(fieldsOf(wave.requests[0] ?? null).interface, [agreed]);
  });

  test("a later wave asks for the test files of the slices it comes after, and is refused while one is missing", () => {
    const later = planned("TD2", { after: [{ slice: "TD1", because: "It adds to TD1's mode." }] });
    const plan = found([planned("TD1"), later], { oneAfterAnotherBecause: "TD2 adds to TD1's mode." });
    assert.deepEqual(testsToLookFor(plan, 2), [testPath("TD1")]);
    assert.deepEqual(testsToLookFor(plan, 1), []);
    const refused = waveOf({ ...asked, wave: 2 }, plan, at);
    assert.deepEqual(refused, {
      kind: "refused",
      sentences: [
        `The slice TD2 comes after TD1, which is not merged into integration: its test ${testPath("TD1")} ` +
          "is not there. Merge TD1's wave first.",
      ],
    });
    const merged = waveOf({ ...asked, wave: 2 }, plan, { ...at, present: [testPath("TD1")] });
    assert.equal(merged.kind, "wave");
  });

  test("a slice it comes after that names no test file cannot be shown merged, so the wave is refused", () => {
    const untested = planned("TD1", { done: [{ id: "DOD-TD1-1", says: "It reads well.", level: "must" }] });
    const later = planned("TD2", { after: [{ slice: "TD1", because: "It adds to TD1's mode." }] });
    const plan = found([untested, later], { oneAfterAnotherBecause: "TD2 adds to TD1's mode." });
    const refused = waveOf({ ...asked, wave: 2 }, plan, at);
    assert.equal(refused.kind, "refused");
    assert.match(JSON.stringify(refused), /forge cannot tell whether TD1 is merged into integration/);
  });

  test("a wave refuses a slice with no interface files, and names every one", () => {
    const bare = (name: string): Json => ({ ...fieldsOf(planned(name)), interface: [] });
    const refused = waveOf(asked, found([bare("TD1"), bare("TD3"), planned("TD4")]), at);
    assert.ok(refused.kind === "refused");
    assert.deepEqual(
      refused.sentences.map((sentence) => sentence.split(" ")[2]),
      ["TD1", "TD3"],
    );
  });

  test("a plan forge.waves gives an error for builds no wave, and a wave the plan lacks is named", () => {
    const shared = planned("TD9", { scope: ["components/modes/td1/**"] });
    const refused = waveOf(asked, found([planned("TD1"), shared]), at);
    assert.equal(refused.kind, "refused");
    assert.match(JSON.stringify(refused), /forge\.waves finds 1 error in the plan docs\/plans\/0099-wave\.yaml/);
    assert.deepEqual(waveOf({ ...asked, wave: 4 }, found([planned("TD1")]), at), {
      kind: "refused",
      sentences: ["The plan docs/plans/0099-wave.yaml has 1 wave, so it has no wave 4; ask for a wave from 1 to 1."],
    });
  });

  test("two slices whose names share a prefix without a dash are built side by side; a name and its dash form clash", () => {
    assert.deepEqual(nameClashes(["TD1", "TD10", "wave-1"]), []);
    assert.deepEqual(nameClashes(["A", "A-2", "wave-1"]), [["A", "A-2"]]);
    assert.deepEqual(nameClashes(["wave", "TD1", "wave-1"]), [["wave", "wave-1"]]);
    const refused = waveOf(
      asked,
      found([planned("A"), planned("A-tests-1", { scope: ["components/modes/b/**"] })]),
      at,
    );
    assert.equal(refused.kind, "refused");
    assert.match(JSON.stringify(refused), /The names A and A-tests-1 clash in a wave/);
  });
});

describe("how many builders at once, and what a slice costs", () => {
  test("the setting sideBySide is 2 when left out, and otherwise as the owner set it, for the kernel to hold to 2 to 8", () => {
    assert.equal(sideBySideOf(undefined), 2);
    assert.equal(sideBySideOf(3), 3);
    assert.equal(sideBySideOf(12), 12);
  });

  test("a slice's rounds ask the models at most 27 times: declare, plant and three each of tests and review three times over, and three builds", () => {
    assert.equal(modelCallsOfASlice(), 27);
  });
});

function joining(name: string, files: readonly string[]): ToJoin {
  const entry = fieldsOf(plannedSlice(name));
  const declared = { files: [...files], names: { gained: [`${name.toLowerCase()}.count`], lost: [], changed: [] } };
  return { name, head: `${name}-head`, slice: entry.slice ?? null, declared, included: true };
}

describe("what the wave asks proof", () => {
  const wave = { name: "wave-1", base };
  const joined = [joining("TD1", ["a.ts"]), joining("TD10", ["b.ts", "a.ts"])];

  test("the combined head is asked once, with the checks only, over every merged slice's scope and declaration", () => {
    const request = fieldsOf(waveProofRequest(wave, joined, "combined"));
    const slice = fieldsOf(request.slice ?? null);
    assert.equal(slice.name, "wave-1");
    assert.deepEqual(slice.scope, ["components/modes/td1/**", "components/modes/td10/**"]);
    assert.deepEqual(
      listOf(slice.done).map((item) => fieldsOf(fieldsOf(item).proof ?? null).kind),
      ["checks"],
    );
    assert.deepEqual(request.declared, {
      files: ["a.ts", "b.ts"],
      names: { gained: ["td1.count", "td10.count"], lost: [], changed: [] },
    });
    assert.equal(request.head, "combined");
    assert.equal(request.base, base);
  });

  test("each merged slice is to be proved alone with its own checks items at its own head, filtered by its own kept tests", () => {
    const asking = fieldsOf(proving(wave, joined, "combined"));
    assert.deepEqual(asking.keptOf, ["TD1", "TD10"]);
    const alone = listOf(asking.whenFailed).map(fieldsOf);
    assert.deepEqual(
      alone.map((each) => each.keptOf),
      [["TD1"], ["TD10"]],
    );
    const first = fieldsOf(alone[0]?.asked ?? null);
    assert.equal(first.head, "TD1-head");
    assert.deepEqual(
      listOf(fieldsOf(first.slice ?? null).done).map((item) => fieldsOf(item).id),
      ["DOD-TD1-2"],
    );
  });
});
