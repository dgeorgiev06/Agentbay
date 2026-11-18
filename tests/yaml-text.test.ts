import assert from "node:assert/strict";
import { test } from "node:test";
import { readYaml } from "../bay/sdk.ts";

const planText = [
  "name: tidy the toolbox",
  "slices:",
  "  - name: TB1",
  "    kind: capability",
  "    scope: [bay/sdk.ts, tests/**]",
  "    after: []",
  "  - name: W1",
  "    kind: mode",
  "    scope:",
  "      - components/base/forge/**",
  "    after:",
  "      - slice: TB1",
  "        because: it reads the plan with the toolbox",
  "",
].join("\n");

function problemsOf(text: string): unknown {
  const read = readYaml(text);
  return read.ok ? read.value : read.problems;
}

function nested(depth: number): string {
  return `${"[".repeat(depth)}1${"]".repeat(depth)}`;
}

const aliasChain = [
  'a: &a ["x", "x", "x", "x", "x", "x", "x", "x", "x"]',
  "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
  "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
  "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c]",
  "e: &e [*d, *d, *d, *d, *d, *d, *d, *d, *d]",
  "f: [*e, *e, *e, *e, *e, *e, *e, *e, *e]",
  "",
].join("\n");

test("a small plan reads to its literal value, and each path has its line", () => {
  const read = readYaml(planText);
  assert.ok(read.ok);
  assert.deepEqual(read.value, {
    name: "tidy the toolbox",
    slices: [
      { name: "TB1", kind: "capability", scope: ["bay/sdk.ts", "tests/**"], after: [] },
      {
        name: "W1",
        kind: "mode",
        scope: ["components/base/forge/**"],
        after: [{ slice: "TB1", because: "it reads the plan with the toolbox" }],
      },
    ],
  });
  assert.equal(read.lineOf(["slices", 1, "after", 0, "because"]), 13);
  assert.equal(read.lineOf(["slices", 0, "kind"]), 4);
  assert.equal(read.lineOf(["slices", 2]), undefined);
});

test("text that is not YAML gives the problem with its line", () => {
  assert.deepEqual(problemsOf("name: plan\nslices:\n  - name: b: c\n"), [
    {
      line: 3,
      message: "The YAML cannot be read: Nested mappings are not allowed in compact mappings.",
      fix: "Correct the YAML syntax at this line.",
    },
  ]);
  assert.deepEqual(problemsOf("a: 1\na: 2\n"), [
    {
      line: 2,
      message: "The YAML cannot be read: Map keys must be unique.",
      fix: "Correct the YAML syntax at this line.",
    },
  ]);
});

test("a text longer than 262,144 characters is refused, and one of exactly that length is read", () => {
  const longest = `a: ${"x".repeat(262_144 - 3)}`;
  assert.equal(readYaml(longest).ok, true);
  assert.deepEqual(problemsOf(`${longest}x`), [
    {
      line: 1,
      message: "The YAML is 262145 characters long, more than the 262144 a YAML text may have.",
      fix: "Make the text shorter.",
    },
  ]);
});

test("a text nested more than 64 levels deep is refused, and one nested 64 deep is read", () => {
  assert.equal(readYaml(nested(64)).ok, true);
  assert.deepEqual(problemsOf(`a:\n  b: ${nested(64)}\n`), [
    {
      line: 2,
      message: "The YAML is nested more than 64 levels deep at this line.",
      fix: "Nest the text less deeply.",
    },
  ]);
});

test("a tag that is not one of YAML's own is refused, with its line", () => {
  assert.deepEqual(problemsOf("name: plan\nrun: !shell rm -rf /\n"), [
    {
      line: 2,
      message: "The YAML has the tag !shell, which is not one of YAML's own: str, int, float, bool, null, map and seq.",
      fix: "Remove the tag and write the value as plain YAML.",
    },
  ]);
  assert.deepEqual(problemsOf("blob: !!binary aGk=\n"), [
    {
      line: 1,
      message:
        "The YAML has the tag !!binary, which is not one of YAML's own: str, int, float, bool, null, map and seq.",
      fix: "Remove the tag and write the value as plain YAML.",
    },
  ]);
  assert.deepEqual(problemsOf("count: !!str 12\n"), { count: "12" });
});

test("aliases are read until they would copy more than 100 nodes", () => {
  assert.deepEqual(problemsOf("a: &a [1, 2]\nb: *a\n"), { a: [1, 2], b: [1, 2] });
  assert.deepEqual(problemsOf(aliasChain), [
    {
      line: 2,
      message: "The YAML's aliases would copy more than 100 nodes.",
      fix: "Write the repeated part out, or use fewer aliases.",
    },
  ]);
});

test("a number JSON cannot hold is refused, with its line", () => {
  assert.deepEqual(problemsOf("most: 3\nleast: -.inf\n"), [
    {
      line: 2,
      message: "The YAML has the number -.inf at this line, which JSON cannot hold.",
      fix: "Write a finite number.",
    },
  ]);
});

test("an empty text is the empty value, and two documents are not one", () => {
  assert.deepEqual(problemsOf(""), null);
  assert.deepEqual(problemsOf("a: 1\n---\nb: 2\n"), [
    {
      line: 2,
      message: "The YAML cannot be read: Source contains multiple documents; please use YAML.parseAllDocuments().",
      fix: "Correct the YAML syntax at this line.",
    },
  ]);
});

test("hostile texts at the size limit are answered within seconds: deep nesting, many errors, an alias chain", () => {
  const started = performance.now();
  assert.deepEqual(problemsOf(nested(131_000)), [
    {
      line: 1,
      message: "The YAML is nested more than 64 levels deep at this line.",
      fix: "Nest the text less deeply.",
    },
  ]);
  const repeated = readYaml("a: 1\n".repeat(52_000));
  assert.ok(!repeated.ok);
  assert.equal(repeated.problems.length, 51_999);
  assert.equal(readYaml(aliasChain).ok, false);
  const milliseconds = performance.now() - started;
  assert.ok(milliseconds < 5000, `${String(milliseconds)} milliseconds`);
});

test("a text deeper than the parser's own stack is refused as too deep", () => {
  assert.deepEqual(problemsOf(nested(20_000)), [
    {
      line: 1,
      message: "The YAML is nested more than 64 levels deep at this line.",
      fix: "Nest the text less deeply.",
    },
  ]);
});
