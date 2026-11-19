import assert from "node:assert/strict";
import { test } from "node:test";
import { refusedDeclaration } from "../scripts/lib/declared.ts";

const scope = ["components/modes/todo/**"];

const added = "components/modes/todo/tests/add.test.ts";

const listed = "components/modes/todo/tests/list.test.ts";

const code = "components/modes/todo/scripts/add.ts";

test("a declaration inside the scope that names no fixed file is taken", () => {
  assert.deepEqual(refusedDeclaration({ scope, fixed: [], files: [code] }), []);
  assert.deepEqual(refusedDeclaration({ scope, fixed: [added], files: [code] }), []);
  assert.deepEqual(
    refusedDeclaration({ scope, fixed: [added, listed], files: [code, "components/modes/todo/a.ts"] }),
    [],
  );
});

test("a declaration that names a test file another agent writes is sent back: one, and one of two", () => {
  assert.deepEqual(refusedDeclaration({ scope, fixed: [added], files: [code, added] }), [
    "The declaration names a file the builder may not change: components/modes/todo/tests/add.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
  assert.deepEqual(refusedDeclaration({ scope, fixed: [added, listed], files: [listed, code] }), [
    "The declaration names a file the builder may not change: components/modes/todo/tests/list.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
  assert.deepEqual(refusedDeclaration({ scope, fixed: [added, listed], files: [listed, added] }), [
    "The declaration names 2 files the builder may not change: " +
      "components/modes/todo/tests/list.test.ts, components/modes/todo/tests/add.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
});

test("a declaration outside the scope is sent back as today, and with a fixed file too, both are said", () => {
  assert.deepEqual(refusedDeclaration({ scope, fixed: [], files: [code, "bay/run.ts"] }), [
    "The declaration names a file outside the slice's write scope: bay/run.ts. " +
      "Declare only files the scope admits: components/modes/todo/**.",
  ]);
  assert.deepEqual(refusedDeclaration({ scope, fixed: [added], files: ["bay/run.ts", added] }), [
    "The declaration names a file outside the slice's write scope: bay/run.ts. " +
      "Declare only files the scope admits: components/modes/todo/**.",
    "The declaration names a file the builder may not change: components/modes/todo/tests/add.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
});
