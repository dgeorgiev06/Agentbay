import assert from "node:assert/strict";
import { test } from "node:test";
import { refusedDeclaration, type Declaring } from "../scripts/lib/declared.ts";

const scope = ["components/modes/todo/**"];

const added = "components/modes/todo/tests/add.test.ts";

const listed = "components/modes/todo/tests/list.test.ts";

const code = "components/modes/todo/scripts/add.ts";

const manifest = "components/modes/todo/mode.yaml";

const designFile = "docs/designs/todo/design.yaml";

const design = [
  designFile,
  "docs/designs/todo/schemas/todo/add-request.json",
  "docs/designs/todo/schemas/todo/add-response.json",
];

const requestCopy = "components/modes/todo/schemas/add-request.json";

const responseCopy = "components/modes/todo/schemas/add-response.json";

const withoutDesign: Pick<Declaring, "kind" | "interface"> = { kind: "mode", interface: [] };

const fromDesign: Omit<Declaring, "files"> = { kind: "mode", scope, fixed: [], interface: design };

test("a declaration inside the scope that names no fixed file is taken", () => {
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [], files: [code] }), []);
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [added], files: [code] }), []);
  assert.deepEqual(
    refusedDeclaration({
      ...withoutDesign,
      scope,
      fixed: [added, listed],
      files: [code, "components/modes/todo/a.ts"],
    }),
    [],
  );
});

test("a declaration that names a test file another agent writes is sent back: one, and one of two", () => {
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [added], files: [code, added] }), [
    "The declaration names a file the builder may not change: components/modes/todo/tests/add.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [added, listed], files: [listed, code] }), [
    "The declaration names a file the builder may not change: components/modes/todo/tests/list.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [added, listed], files: [listed, added] }), [
    "The declaration names 2 files the builder may not change: " +
      "components/modes/todo/tests/list.test.ts, components/modes/todo/tests/add.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
});

test("a declaration outside the scope is sent back as today, and with a fixed file too, both are said", () => {
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [], files: [code, "bay/run.ts"] }), [
    "The declaration names a file outside the slice's write scope: bay/run.ts. " +
      "Declare only files the scope admits: components/modes/todo/**.",
  ]);
  assert.deepEqual(refusedDeclaration({ ...withoutDesign, scope, fixed: [added], files: ["bay/run.ts", added] }), [
    "The declaration names a file outside the slice's write scope: bay/run.ts. " +
      "Declare only files the scope admits: components/modes/todo/**.",
    "The declaration names a file the builder may not change: components/modes/todo/tests/add.test.ts. " +
      "Another agent writes the tests; leave them out.",
  ]);
});

test("a mode slice from a design that declares the copies of the design's schema files is taken", () => {
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [manifest, code, requestCopy, responseCopy] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [manifest, code, requestCopy] }), []);
});

test("a mode slice from a design that declares mode.yaml and no schema file of the mode is sent back", () => {
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [manifest, code] }), [
    "The declaration lists no schema file in the mode's folder components/modes/todo, and its mode.yaml may " +
      "name only files inside that folder: add components/modes/todo/schemas/add-request.json, " +
      "components/modes/todo/schemas/add-response.json, each a copy of the design's file of that name.",
  ]);
  assert.equal(
    refusedDeclaration({ ...fromDesign, files: [manifest, "components/modes/todo/tests/add.example.json"] }).length,
    1,
  );
});

test("the schema rule asks nothing of a slice with no design schema, no mode.yaml, or of another kind", () => {
  assert.deepEqual(refusedDeclaration({ ...fromDesign, interface: [designFile], files: [manifest] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [code] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, kind: "capability", files: [manifest] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, kind: "interface", files: [manifest] }), []);
});
