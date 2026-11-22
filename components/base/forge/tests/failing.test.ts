import assert from "node:assert/strict";
import { test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf } from "../scripts/lib/slice-form.ts";
import { failingOf, filteredProof, withoutCases } from "../scripts/lib/failing.ts";
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

test("a message that shares 20 characters with a test keeps what it does not share, the shared run shown as one mark, and is counted", () => {
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", twenty)])], tests);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted", file: named, message: "got …!" }]);
  assert.equal(failing.withheld, 1);
});

test("a message all of whose words a test holds is withheld: the name alone, and the count", () => {
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", ` ${alphabet}. `)])], tests);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted", file: named }]);
  assert.equal(failing.withheld, 1);
});

test("of two failing cases, only the one whose message quotes a test is counted", () => {
  const verdict = failed("DOD-F1-1", [failure("a quill is counted", nineteen), failure("a quill is listed", twenty)]);
  const failing = failingOf(slice, [verdict], tests);
  assert.deepEqual(failing.cases, [
    { name: "a quill is counted", file: named, message: nineteen },
    { name: "a quill is listed", file: named, message: "got …!" },
  ]);
  assert.equal(failing.withheld, 1);
});

test("a message with no letter or digit, such as the bracket that opens a list, is told as one fixed sentence and not counted", () => {
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", " [ ")])], tests);
  assert.deepEqual(failing.cases, [
    {
      name: "a quill is counted",
      file: named,
      message:
        "The first line of the test runner's message for this case holds no letter or digit, and forge hands on no other line of it.",
    },
  ]);
  assert.equal(failing.withheld, 0);
});

test("the kernel's sentence on a mode that does not load reaches the builder whole", () => {
  const sentence =
    "actions.add.input is not in the expected form. Expected: A path relative to the mode's folder that neither starts with / nor contains a .. segment.";
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", sentence)])], tests);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted", file: named, message: sentence }]);
  assert.equal(failing.withheld, 0);
});

test("a run a test holds across a line break is withheld, and a control character is shown as a space", () => {
  const broken = [{ path: named, text: "const text = 'ABCDEFGHIJ\nKLMNOPQRSTUVWXYZ';\n" }];
  const reported = "saw ABCDEFGHIJ\nKLMNOPQRS and\u0007more";
  const failing = failingOf(slice, [failed("DOD-F1-1", [failure("a quill is counted", reported)])], broken);
  assert.deepEqual(failing.cases, [{ name: "a quill is counted", file: named, message: "saw … and more" }]);
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

test("the final proof's answer keeps proof's shape, and a case's message that quotes a test is emptied, no other", () => {
  const answer = {
    verdicts: [failed("DOD-F1-1", [failure("a quill is counted", twenty), failure("another", nineteen)])],
    judgement: [],
    size: [{ path: named, head: 2 }],
  };
  assert.deepEqual(filteredProof(answer, tests), {
    verdicts: [
      {
        item: "DOD-F1-1",
        kind: "fails-first",
        verdict: "failed",
        detail: "The named tests fail on the head.",
        cases: {
          failures: [
            { name: "a quill is counted", file: `/tmp/proof-copy/${named}`, message: "", charactersCut: 0 },
            { name: "another", file: `/tmp/proof-copy/${named}`, message: nineteen, charactersCut: 0 },
          ],
          failuresNotListed: 0,
          notLoaded: [],
        },
      },
    ],
    judgement: [],
    size: [{ path: named, head: 2 }],
  });
});

test("in the final proof's answer, a detail or a reason that quotes a test is replaced by a sentence that says so", () => {
  const kept = "Proof's reason is kept from the card: it quotes a test.";
  const answer = {
    verdicts: [
      { item: "DOD-F1-1", kind: "checks", verdict: "inconclusive", reason: `The test run is not known: ${twenty}` },
      { item: "DOD-F1-2", kind: "fails-first", verdict: "failed", detail: `The check x found ${twenty}.` },
      { item: "scope", kind: "in-scope", verdict: "inconclusive", reason: `The run is not known: ${nineteen}` },
    ],
    judgement: [],
    size: [],
  };
  assert.deepEqual(fieldsOf(filteredProof(answer, tests)).verdicts, [
    { item: "DOD-F1-1", kind: "checks", verdict: "inconclusive", reason: kept },
    { item: "DOD-F1-2", kind: "fails-first", verdict: "failed", detail: kept },
    { item: "scope", kind: "in-scope", verdict: "inconclusive", reason: `The run is not known: ${nineteen}` },
  ]);
});

test("with no kept tests found, the filter fails closed: every message is withheld and counted, names kept, and every reason replaced", () => {
  const kept = "Proof's reason is kept from the card: it quotes a test.";
  const cases = [
    failure("a quill is counted", nineteen),
    failure("another", "expected 2 to be 1"),
    failure("blank", ""),
  ];
  const verdicts = [failed("DOD-F1-1", cases)];
  assert.deepEqual(failingOf(slice, verdicts, []), {
    items: ["DOD-F1-1"],
    cases: [{ name: "a quill is counted" }, { name: "another" }, { name: "blank" }],
    withheld: 2,
    notListed: 0,
    notLoaded: [],
  });
  const answer = fieldsOf(filteredProof({ verdicts, judgement: [], size: [] }, []));
  assert.deepEqual(answer.verdicts, [
    {
      item: "DOD-F1-1",
      kind: "fails-first",
      verdict: "failed",
      detail: kept,
      cases: {
        failures: [
          { name: "a quill is counted", file: `/tmp/proof-copy/${named}`, message: "", charactersCut: 0 },
          { name: "another", file: `/tmp/proof-copy/${named}`, message: "", charactersCut: 0 },
          { name: "blank", file: `/tmp/proof-copy/${named}`, message: "", charactersCut: 0 },
        ],
        failuresNotListed: 0,
        notLoaded: [],
      },
    },
  ]);
});
