import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, Plan, PlannedSlice } from "../scripts/lib/plan.ts";
import { workOut } from "../scripts/lib/plan-waves.ts";

function slice(name: string, scope: readonly string[], after: readonly string[] = []): PlannedSlice {
  return {
    name,
    title: `The slice ${name}`,
    kind: "mode",
    scope,
    after: after.map((other) => ({ slice: other, because: `${name} reads what ${other} adds.` })),
  };
}

function plan(slices: readonly PlannedSlice[]): Plan {
  return { title: "A plan", slices };
}

const noFeatures: readonly Feature[] = [];

const sixSlices = [
  slice("A", ["a/**"]),
  slice("B", ["b/**"]),
  slice("C", ["c/**"], ["A"]),
  slice("D", ["d/**"], ["B"]),
  slice("E", ["e/**"], ["C"]),
  slice("F", ["f/**"], ["C", "D"]),
];

test("six slices in three waves, with the longest chain", () => {
  assert.deepEqual(workOut(plan(sixSlices), noFeatures), {
    waves: [
      { wave: 1, slices: ["A", "B"], builders: 2 },
      { wave: 2, slices: ["C", "D"], builders: 2 },
      { wave: 3, slices: ["E", "F"], builders: 2 },
    ],
    notPlaced: [],
    longestChain: ["A", "C", "E"],
    problems: [],
  });
});

test("the longest chain follows the after that has the longest chain behind it", () => {
  const slices = [slice("A", ["a"]), slice("B", ["b"], ["A"]), slice("C", ["c"]), slice("D", ["d"], ["C", "B"])];
  assert.deepEqual(workOut(plan(slices), noFeatures).longestChain, ["A", "B", "D"]);
});

test("two slices whose scopes share a path, ordered by an after, are in two waves with no problem", () => {
  const slices = [slice("A", ["bay/runs/**"]), slice("B", ["bay/runs/engine.ts"], ["A"]), slice("C", ["docs/**"])];
  assert.deepEqual(workOut(plan(slices), noFeatures), {
    waves: [
      { wave: 1, slices: ["A", "C"], builders: 2 },
      { wave: 2, slices: ["B"], builders: 1 },
    ],
    notPlaced: [],
    longestChain: ["A", "B"],
    problems: [],
  });
});

test("two slices whose scopes share a path, with no order, are never in one wave, and the problem names both patterns and a path", () => {
  const slices = [slice("A", ["docs/**", "bay/runs/**"]), slice("B", ["tests/x.ts", "bay/runs/engine.ts"])];
  assert.deepEqual(workOut(plan(slices), noFeatures), {
    waves: [
      { wave: 1, slices: ["A"], builders: 1 },
      { wave: 2, slices: ["B"], builders: 1 },
    ],
    notPlaced: [],
    longestChain: ["A"],
    problems: [
      {
        kind: "scopes share a path",
        level: "error",
        slices: ["A", "B"],
        patterns: ["bay/runs/**", "bay/runs/engine.ts"],
        example: "bay/runs/engine.ts",
        sentence:
          "A and B could run in one wave, but both scopes admit bay/runs/engine.ts: bay/runs/** in A and bay/runs/engine.ts in B. Narrow a scope, or order the two with an after.",
      },
    ],
  });
});

test("a slice is moved to a later wave only past the slices it shares a path with", () => {
  const slices = [slice("A", ["x/**"]), slice("B", ["x/y.ts"]), slice("C", ["z/**"], ["A"])];
  assert.deepEqual(workOut(plan(slices), noFeatures).waves, [
    { wave: 1, slices: ["A"], builders: 1 },
    { wave: 2, slices: ["B", "C"], builders: 2 },
  ]);
});

test("two slices whose scopes may share a path are never in one wave, and the problem names both patterns", () => {
  const slices = [slice("A", ["bay//x.ts"]), slice("B", ["bay/x.ts"])];
  assert.deepEqual(workOut(plan(slices), noFeatures), {
    waves: [
      { wave: 1, slices: ["A"], builders: 1 },
      { wave: 2, slices: ["B"], builders: 1 },
    ],
    notPlaced: [],
    longestChain: ["A"],
    problems: [
      {
        kind: "scopes may share a path",
        level: "error",
        slices: ["A", "B"],
        patterns: ["bay//x.ts", "bay/x.ts"],
        sentence:
          'A and B could run in one wave, and forge cannot tell whether bay//x.ts in A and bay/x.ts in B admit a path in common: "bay//x.ts" is not a pattern: it holds two slashes in a row. Narrow a scope, or order the two with an after.',
      },
    ],
  });
});

test("an after that names no slice is a problem, and the slice is placed as if it were not there", () => {
  assert.deepEqual(workOut(plan([slice("A", ["a"]), slice("B", ["b"], ["Z"])]), noFeatures), {
    waves: [{ wave: 1, slices: ["A", "B"], builders: 2 }],
    notPlaced: [],
    longestChain: ["A"],
    problems: [
      {
        kind: "after names no slice",
        level: "error",
        slice: "B",
        after: "Z",
        sentence: "B comes after Z, but the plan has no slice named Z. Correct the name, or add the slice.",
      },
    ],
  });
});

test("a cycle is a problem with the names in it, and no wave holds its slices or a slice after them", () => {
  const slices = [
    slice("A", ["a"], ["C"]),
    slice("B", ["b"], ["A"]),
    slice("C", ["c"], ["B"]),
    slice("D", ["d"], ["B"]),
    slice("E", ["e"]),
    slice("F", ["f"], ["F"]),
  ];
  assert.deepEqual(workOut(plan(slices), noFeatures), {
    waves: [{ wave: 1, slices: ["E"], builders: 1 }],
    notPlaced: ["A", "B", "C", "D", "F"],
    longestChain: ["E"],
    problems: [
      {
        kind: "cycle",
        level: "error",
        slices: ["A", "B", "C"],
        sentence: "A, B and C wait for each other, so none of them can start. Remove an after among them.",
      },
      {
        kind: "cycle",
        level: "error",
        slices: ["F"],
        sentence: "F comes after itself, so it cannot start. Remove that after.",
      },
    ],
  });
});

test("a scope that admits every private file of a feature is a warning that the feature may need an entry first", () => {
  const features: readonly Feature[] = [
    { name: "runs", private: ["bay/runs/engine.ts", "bay/runs/walk.ts"] },
    { name: "safety", private: [] },
    { name: "broker", private: ["bay/broker/rule.ts", "bay/broker/inner/host.ts"] },
  ];
  const slices = [slice("A", ["bay/runs/**", "bay/policy.ts", "bay/broker/*.ts"])];
  assert.deepEqual(workOut(plan(slices), features).problems, [
    {
      kind: "whole feature",
      level: "warning",
      slice: "A",
      feature: "runs",
      sentence:
        "A's scope admits every private file of the kernel feature runs. The feature may need an entry first, so that a slice can be given a narrower scope.",
    },
  ]);
});

test("a plan in which every slice waits for the one before is a problem, unless it says why", () => {
  const slices = [slice("A", ["a"]), slice("B", ["b"], ["A"]), slice("C", ["c"], ["B"])];
  assert.deepEqual(workOut(plan(slices), noFeatures).problems, [
    {
      kind: "one after another",
      level: "error",
      sentence:
        "Every slice waits for the one before, so no two can run side by side. Say why no other order exists in oneAfterAnotherBecause, or remove an after that is not needed.",
    },
  ]);
  const said = { ...plan(slices), oneAfterAnotherBecause: "Each slice changes the one file the next reads." };
  assert.deepEqual(workOut(said, noFeatures).problems, []);
});

test("three problems together are all reported", () => {
  const slices = [
    slice("A", ["a/**"], ["B"]),
    slice("B", ["b/**"], ["A"]),
    slice("C", ["c/**"], ["Y"]),
    slice("D", ["c/d.ts"]),
  ];
  assert.deepEqual(
    workOut(plan(slices), noFeatures).problems.map((problem) => problem.kind),
    ["after names no slice", "cycle", "scopes share a path"],
  );
});

test("a plan of one slice has one wave and no problem", () => {
  assert.deepEqual(workOut(plan([slice("A", ["a/**"])]), noFeatures), {
    waves: [{ wave: 1, slices: ["A"], builders: 1 }],
    notPlaced: [],
    longestChain: ["A"],
    problems: [],
  });
});

test("an empty plan has no wave, no chain and no problem", () => {
  assert.deepEqual(workOut(plan([]), noFeatures), { waves: [], notPlaced: [], longestChain: [], problems: [] });
});
