import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { sliceOf } from "../scripts/lib/cards.ts";
import { failingOf, withoutCases } from "../scripts/lib/failing.ts";
import { quotesAny } from "../scripts/lib/quoting.ts";

const named = "components/modes/f1/tests/quill.test.ts";

const other = "components/modes/f1/tests/other.test.ts";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const tests = [
  { path: named, text: `const sample = '${alphabet}';\ntest("a quill is counted", () => {});\n` },
  { path: other, text: 'test("another quill is counted", () => {});\n' },
];

const slice = sliceOf({
  name: "F1",
  kind: "mode",
  scope: ["components/modes/f1/**"],
  after: [],
  done: [
    { id: "DOD-F1-1", says: "A quill is counted.", level: "must", proof: { kind: "fails-first", tests: [named] } },
    { id: "DOD-F1-2", says: "Another is counted.", level: "should", proof: { kind: "fails-first", tests: [other] } },
  ],
});

const nineteen = `got ${alphabet.slice(0, 19)}!`;

const twenty = `got ${alphabet.slice(0, 20)}!`;

function failure(name: string, message: string, file = `/tmp/proof-copy/${named}`): Json {
  return { name, file, message, charactersCut: 0 };
}

function failed(item: string, failures: readonly Json[], notLoaded: readonly string[] = []): Json {
  return {
    item,
    kind: "fails-first",
    verdict: "failed",
    detail: "The named tests fail on the head.",
    cases: { failures: [...failures], failuresNotListed: 0, notLoaded: [...notLoaded] },
  };
}

test("a text quotes a test when it shares a run of 20 characters with it, and not at 19", () => {
  const texts = tests.map((each) => each.text);
  assert.equal(quotesAny(nineteen, texts), false);
  assert.equal(quotesAny(twenty, texts), true);
  assert.equal(quotesAny(alphabet.slice(3, 23), texts), true);
  assert.equal(quotesAny("", texts), false);
  assert.equal(quotesAny(alphabet, []), false);
});

test("a message that shares 19 characters with a test reaches the builder whole, with the case's name and file", () => {
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", nineteen)])], tests);
  assert.deepEqual(failing, {
    items: ["DOD-F1-1"],
    cases: [{ name: "a quill is counted", file: named, message: nineteen }],
    withheld: 0,
    notListed: 0,
    notLoaded: [],
  });
});

test("a message that shares 20 characters with a test is withheld: the name alone, and the count", () => {
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", twenty)])], tests);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted", file: named }]);
  assert.equal(failing.withheld, 1);
});

test("of two failing cases, only the one whose message quotes a test is withheld", () => {
  const verdict = failed("DOD-F1-1", [failure("a quill is counted", nineteen), failure("a quill is listed", twenty)]);
  const failing = failingOf(slice, [verdict], tests);
  assert.deepEqual(failing.cases, [
    { name: "a quill is counted", file: named, message: nineteen },
    { name: "a quill is listed", file: named },
  ]);
  assert.equal(failing.withheld, 1);
});

test("the filter compares with the tests' text, not with anything else the builder wrote", () => {
  const ownCode = "TypeError: quillCount is not a function at quill.ts";
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", ownCode)])], tests);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted", file: named, message: ownCode }]);
  const quoting = `got: ${tests[1]?.text.slice(0, 30) ?? ""}`;
  const second = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", quoting)])], tests);
  assert.equal(second.withheld, 1);
});

test("a file the slice does not name is left out; a case is named once; a should item's cases are not told", () => {
  const verdicts = [
    failed("DOD-F1-1", [
      failure("a quill is counted", "", "/tmp/proof-copy/components/modes/f1/tests/helper.ts"),
      failure("a quill is counted", "", "/tmp/proof-copy/components/modes/f1/tests/helper.ts"),
    ]),
    failed("DOD-F1-2", [failure("another quill is counted", "nothing", `/tmp/proof-copy/${other}`)]),
  ];
  const failing = failingOf(slice, verdicts, tests);
  assert.deepEqual(failing.items, ["DOD-F1-1"]);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted" }]);
});

test("a test file that did not load is named by its path alone; another file is left out", () => {
  const one = failingOf(slice, [failed("DOD-F1-1", [], [`/tmp/proof-copy/${named}`])], tests);
  assert.deepEqual(one.notLoaded, [named]);
  assert.deepEqual(one.cases, []);
  const two = failingOf(slice, [failed("DOD-F1-1", [], [`/tmp/proof-copy/${named}`, "/tmp/elsewhere.ts"])], tests);
  assert.deepEqual(two.notLoaded, [named]);
  assert.ok(!JSON.stringify(two).includes(alphabet));
});

test("a case's name loses its control characters and is cut at 200 characters", () => {
  const long = `a\u0007quill${"s".repeat(300)}`;
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure(long, "")])], tests);
  assert.equal(failing.cases[0]?.name, `a quill${"s".repeat(193)}`);
});

test("the cases the toolchain did not list are counted across items", () => {
  const verdict = {
    item: "DOD-F1-1",
    kind: "fails-first",
    verdict: "failed",
    detail: "",
    cases: { failures: [], failuresNotListed: 4, notLoaded: [] },
  };
  assert.equal(failingOf(slice, [verdict], tests).notListed, 4);
});

test("verdicts lose their cases and keep every other field", () => {
  const passed = { item: "scope", kind: "in-scope", verdict: "passed", detail: "It held." };
  assert.deepEqual(withoutCases([passed]), [passed]);
  assert.deepEqual(withoutCases([passed, failed("DOD-F1-1", [failure("x", twenty)])]), [
    passed,
    { item: "DOD-F1-1", kind: "fails-first", verdict: "failed", detail: "The named tests fail on the head." },
  ]);
});
