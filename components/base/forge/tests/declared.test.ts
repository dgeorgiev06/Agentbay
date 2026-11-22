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

const addExample = "components/modes/todo/tests/add.example.json";

const withoutDesign: Pick<Declaring, "kind" | "interface" | "existing"> = { kind: "mode", interface: [], existing: [] };

const fromDesign: Omit<Declaring, "files"> = { kind: "mode", scope, fixed: [], interface: design, existing: [] };

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

test("a mode slice from a design that declares the copies of the design's schema files and its examples is taken", () => {
  const declared = [manifest, code, requestCopy, responseCopy, addExample];
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: declared }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [manifest, code, requestCopy, addExample] }), []);
});

test("a mode slice from a design that declares mode.yaml and no schema file of the mode is sent back", () => {
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [manifest, code, addExample] }), [
    "The declaration lists no schema file in the mode's folder components/modes/todo, and its mode.yaml may " +
      "name only files inside that folder: add components/modes/todo/schemas/add-request.json, " +
      "components/modes/todo/schemas/add-response.json, each a copy of the design's file of that name.",
  ]);
});

const twoActions = [...design, "docs/designs/todo/schemas/todo/list-request.json"];

const listExample = "components/modes/todo/tests/list.example.json";

test("a mode slice from a design that declares mode.yaml and no example file of an action is told which to add", () => {
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [manifest, code, requestCopy] }), [
    "The declaration lists no example file for an action of the design, and bay check needs " +
      "tests/<action>.example.json in the mode's folder for every action: add " +
      "components/modes/todo/tests/add.example.json, each the input and the answer of one of the design's " +
      "worked examples of that action that answers.",
  ]);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, interface: twoActions, files: [manifest, code] }), [
    "The declaration lists no schema file in the mode's folder components/modes/todo, and its mode.yaml may " +
      "name only files inside that folder: add components/modes/todo/schemas/add-request.json, " +
      "components/modes/todo/schemas/add-response.json, components/modes/todo/schemas/list-request.json, " +
      "each a copy of the design's file of that name.",
    "The declaration lists no example file for 2 actions of the design, and bay check needs " +
      "tests/<action>.example.json in the mode's folder for every action: add " +
      "components/modes/todo/tests/add.example.json, components/modes/todo/tests/list.example.json, each the " +
      "input and the answer of one of the design's worked examples of that action that answers.",
  ]);
});

test("an example file the mode already has, and leaves as it is, need not be declared", () => {
  const declaring = { ...fromDesign, interface: twoActions, existing: [addExample] };
  assert.deepEqual(refusedDeclaration({ ...declaring, files: [manifest, requestCopy, listExample] }), []);
});

test("the schema and example rule asks nothing of a slice with no design schema, no mode.yaml, or of another kind", () => {
  assert.deepEqual(refusedDeclaration({ ...fromDesign, interface: [designFile], files: [manifest] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, files: [code] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, kind: "capability", files: [manifest] }), []);
  assert.deepEqual(refusedDeclaration({ ...fromDesign, kind: "interface", files: [manifest] }), []);
});
