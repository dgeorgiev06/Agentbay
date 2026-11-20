import assert from "node:assert/strict";
import { test } from "node:test";
import type { Slice } from "../scripts/lib/slice-form.ts";
import { handedTestsOf, namedTests, refusedTests, type HandedTest } from "../scripts/lib/handed-tests.ts";

const first = "components/modes/todo/tests/add.test.ts";

const second = "components/modes/todo/tests/list.test.ts";

function sliceNaming(tests: readonly (readonly string[])[]): Slice {
  return {
    name: "TD1",
    kind: "mode",
    scope: ["components/modes/todo/**"],
    after: [],
    done: [
      ...tests.map((named, at) => ({
        id: `DOD-TD1-${String(at + 1)}`,
        says: "A todo that was added is listed.",
        level: "must" as const,
        proof: { kind: "fails-first" as const, tests: named },
      })),
      { id: "DOD-TD1-9", says: "The checks pass.", level: "must", proof: { kind: "checks" } },
      { id: "DOD-TD1-10", says: "It reads well.", level: "should" },
    ],
  };
}

const oneNamed = sliceNaming([[first]]);

const twoNamed = sliceNaming([[first], [second]]);

function written(path: string): HandedTest {
  return { path, text: `import { test } from "node:test";\n\ntest("${path} holds", () => {});\n` };
}

test("the named tests are every path the fails-first items name, each once, in the order named", () => {
  assert.deepEqual(namedTests(oneNamed), [first]);
  assert.deepEqual(namedTests(twoNamed), [first, second]);
  assert.deepEqual(namedTests(sliceNaming([[first, second], [second]])), [first, second]);
  assert.deepEqual(namedTests(sliceNaming([])), []);
});

test("every named test handed in once, with a case, is taken: one file and two", () => {
  assert.deepEqual(refusedTests(oneNamed, [written(first)]), []);
  assert.deepEqual(refusedTests(twoNamed, [written(first), written(second)]), []);
  assert.deepEqual(refusedTests(twoNamed, [written(second), written(first)]), []);
});

test("a case counts when a line starts a call of test or it, indented or not", () => {
  const cases = ['test("a", () => {});', '  it("a", () => {});', "\ttest ('a', () => {});"];
  for (const text of cases) {
    assert.deepEqual(refusedTests(oneNamed, [{ path: first, text }]), [], text);
  }
});

test("a path outside the write scope is sent back, by its path and the scope", () => {
  const outside = "bay/runs/runs.test.ts";
  const slice = sliceNaming([[first, outside]]);
  assert.deepEqual(refusedTests(slice, [written(first), written(outside)]), [
    "The tests name a file outside the slice's write scope: bay/runs/runs.test.ts. " +
      "Hand in only files the scope admits: components/modes/todo/**.",
  ]);
  const both = sliceNaming([[outside, "tests/other.test.ts"]]);
  assert.deepEqual(refusedTests(both, [written(outside), written("tests/other.test.ts")]), [
    "The tests name 2 files outside the slice's write scope: bay/runs/runs.test.ts, tests/other.test.ts. " +
      "Hand in only files the scope admits: components/modes/todo/**.",
  ]);
});

test("a path inside the scope that no fails-first item names is sent back", () => {
  const other = "components/modes/todo/tests/other.test.ts";
  assert.deepEqual(refusedTests(oneNamed, [written(first), written(other)]), [
    "The tests name a file that no fails-first item names: components/modes/todo/tests/other.test.ts. " +
      "Hand in only the named test files: components/modes/todo/tests/add.test.ts.",
  ]);
  assert.deepEqual(refusedTests(oneNamed, [written(other)]), [
    "The tests name a file that no fails-first item names: components/modes/todo/tests/other.test.ts. " +
      "Hand in only the named test files: components/modes/todo/tests/add.test.ts.",
    "No test was handed in for components/modes/todo/tests/add.test.ts, which a fails-first item names. " +
      "Hand in every named file.",
  ]);
});

test("a named test left out is sent back: one of two, and both", () => {
  assert.deepEqual(refusedTests(twoNamed, [written(first)]), [
    "No test was handed in for components/modes/todo/tests/list.test.ts, which a fails-first item names. " +
      "Hand in every named file.",
  ]);
  assert.deepEqual(refusedTests(twoNamed, []), [
    "No test was handed in for components/modes/todo/tests/add.test.ts, components/modes/todo/tests/list.test.ts, " +
      "which a fails-first item names. Hand in every named file.",
  ]);
});

test("a file given twice is sent back once", () => {
  assert.deepEqual(refusedTests(oneNamed, [written(first), written(first)]), [
    "The tests give components/modes/todo/tests/add.test.ts more than once. Give each file once.",
  ]);
});

test("an empty or blank text is sent back, and only the one that is", () => {
  assert.deepEqual(refusedTests(twoNamed, [written(first), { path: second, text: "" }]), [
    "The test text of components/modes/todo/tests/list.test.ts is empty. Write the file whole.",
  ]);
  assert.deepEqual(
    refusedTests(twoNamed, [
      { path: first, text: " \n\t\n" },
      { path: second, text: "" },
    ]),
    [
      "The test text of components/modes/todo/tests/add.test.ts, components/modes/todo/tests/list.test.ts is empty. " +
        "Write the file whole.",
    ],
  );
});

test("a text with no case is sent back, and only the one that has none", () => {
  const caseless = { path: second, text: 'import { test } from "node:test";\nconst tested = "test(";\n' };
  assert.deepEqual(refusedTests(twoNamed, [written(first), caseless]), [
    "The test text of components/modes/todo/tests/list.test.ts has no case: no line starts a call of test or it. " +
      "Write a case for each condition the file holds.",
  ]);
  const describedOnly = { path: first, text: 'describe("todo", () => {});\n' };
  assert.equal(refusedTests(twoNamed, [describedOnly, caseless]).length, 1);
});

test("the tests are read from the output, each path and text, and a missing field is read as empty", () => {
  assert.deepEqual(handedTestsOf({ tests: [{ path: first, text: "a" }, { path: second }] }), [
    { path: first, text: "a" },
    { path: second, text: "" },
  ]);
  assert.deepEqual(handedTestsOf({}), []);
});
