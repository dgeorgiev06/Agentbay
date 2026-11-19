import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { sliceOf } from "../scripts/lib/cards.ts";
import { caseNamesOf, isOneSentence, refusedReview, type Reviewing } from "../scripts/lib/review.ts";

const testPath = "components/modes/v1/tests/quill.test.ts";

const testText = [
  'import { quillCount } from "../scripts/quill.ts";',
  'test("a quill that was added is counted", () => {',
  '  assert.equal(quillCount("first quill of the morning"), 1, "the quill is counted once");',
  "});",
  "it('an empty quill is refused', () => {});",
  "",
].join("\n");

const reviewing: Reviewing = {
  slice: sliceOf({
    name: "V1",
    kind: "mode",
    scope: ["components/modes/v1/**"],
    after: [],
    done: [
      { id: "DOD-V1-1", says: "A quill is counted.", level: "must", proof: { kind: "fails-first", tests: [testPath] } },
      { id: "DOD-V1-2", says: "An empty quill is refused.", level: "should" },
    ],
  }),
  tests: [{ path: testPath, text: testText }],
  failing: ["a quill that was added is counted, round two"],
  practices: ["P-05", "TS-18"],
};

const heldBoth: readonly Json[] = [
  { item: "DOD-V1-1", held: true, cases: ["a quill that was added is counted"] },
  { item: "DOD-V1-2", held: true, cases: ["an empty quill is refused"] },
];

function forBuilder(fix: string, caseName = "a quill that was added is counted"): Json {
  return { to: "builder", case: caseName, question: "P-05", fix };
}

function refused(findings: readonly Json[], conditions: readonly Json[] = heldBoth): readonly string[] {
  return refusedReview({ conditions: [...conditions], findings: [...findings] }, reviewing);
}

describe("the review's check, as a pure function", () => {
  test("a review with a verdict on each condition and no finding is taken", () => {
    assert.deepEqual(refused([]), []);
  });

  test("a finding for the builder that quotes a test is refused, and the feedback quotes nothing of it", () => {
    const quoting = forBuilder('Count "first quill of the morning" once.');
    const feedback = refused([quoting]);
    assert.deepEqual(feedback, [
      "Finding 1, for the builder, shares a run of 20 or more characters with the tests: " +
        "say it in your own words; the builder never reads a line of a test.",
    ]);
    assert.ok(!feedback.join(" ").includes("first quill"));
  });

  test("of two findings for the builder, only the one that quotes a test is refused", () => {
    const own = forBuilder("Count each quill once, through the count action.");
    const quoting = forBuilder('Make quillCount("first quill of the morning") return one.');
    assert.deepEqual(refused([own]), []);
    assert.deepEqual(refused([own, quoting]), [
      "Finding 2, for the builder, shares a run of 20 or more characters with the tests: " +
        "say it in your own words; the builder never reads a line of a test.",
    ]);
  });

  test("a finding for the test writer may quote the test", () => {
    const quoting = {
      to: "test-writer",
      case: "a new case",
      question: "Q2",
      fix: 'Assert "first quill of the morning" whole.',
    };
    assert.deepEqual(refused([quoting]), []);
  });

  test("a finding with no addressee, or another, is refused", () => {
    const noAddressee = { case: "a quill that was added is counted", question: "Q2", fix: "Do." };
    assert.deepEqual(refused([noAddressee]), ["Finding 1 names no addressee: to is test-writer or builder."]);
    assert.deepEqual(refused([{ ...noAddressee, to: "owner" }]), [
      "Finding 1 names no addressee: to is test-writer or builder.",
    ]);
  });

  test("free text beyond the bounded fields is refused, in a finding, a verdict or the review", () => {
    const own = forBuilder("Count each quill once.");
    assert.deepEqual(refused([{ ...fieldsOf(own), note: "and more" }]), [
      "Finding 1 has the field note; a finding has to, case, question and fix only.",
    ]);
    const conditions = [{ ...fieldsOf(heldBoth[0] ?? null), because: "words" }, heldBoth[1] ?? null];
    assert.deepEqual(refused([], conditions), [
      "The verdict on DOD-V1-1 has the field because; it has item, held, and cases or why.",
    ]);
    assert.deepEqual(refusedReview({ conditions: [...heldBoth], findings: [], summary: "all good" }, reviewing), [
      "The review has the field summary; it has conditions and findings only.",
    ]);
  });

  test("a fix of more than one sentence is refused", () => {
    assert.deepEqual(refused([forBuilder("Count each quill once. Then list them.")]), [
      "The fix of finding 1 is not one sentence of at most 200 characters.",
    ]);
  });

  test("a finding for the builder names a case the tests name, or a failing case proof named", () => {
    assert.deepEqual(
      refused([forBuilder("Count each quill once.", "a quill that was added is counted, round two")]),
      [],
    );
    assert.deepEqual(refused([forBuilder("Count each quill once.", 'quillCount("first quill')]), [
      "Finding 1, for the builder, names a case the tests do not name. Name the case as the tests name it.",
    ]);
  });

  test("a question is one of the ten, negative-paths, condition, or a practice given", () => {
    const asking = (question: string): Json => ({ ...fieldsOf(forBuilder("Count once.")), question });
    assert.deepEqual(refused([asking("Q10"), asking("negative-paths"), asking("condition"), asking("TS-18")]), []);
    assert.deepEqual(refused([asking("Q11")]), [
      "Finding 1 names no question: Q1 to Q10, negative-paths, condition, or the id of a practice given.",
    ]);
    assert.deepEqual(refused([asking("P-01")]), [
      "Finding 1 names the practice P-01, which is not among the practices given.",
    ]);
  });

  test("each condition has one verdict, and a reason that quotes a test is refused", () => {
    assert.deepEqual(refused([], [heldBoth[0] ?? null]), [
      "The review gives no verdict on DOD-V1-2. Say for each condition whether it is held.",
    ]);
    assert.deepEqual(refused([], [...heldBoth, heldBoth[0] ?? null, { item: "DOD-V1-9", held: true, cases: [] }]), [
      "The review gives DOD-V1-1 more than once. Give each condition once.",
      "The review names DOD-V1-9, which is not a condition of the slice.",
      "DOD-V1-9 is held by no case named. Name the cases that hold it, or say it is not held and why.",
    ]);
    const notHeld = { item: "DOD-V1-2", held: false, why: "No case gives an empty quill and checks the refusal." };
    assert.deepEqual(refused([], [heldBoth[0] ?? null, notHeld]), []);
    const quoting = { item: "DOD-V1-2", held: false, why: 'It checks quillCount("first quill of the morning").' };
    assert.deepEqual(refused([], [heldBoth[0] ?? null, quoting]), [
      "The reason DOD-V1-2 is not held shares a run of 20 or more characters with the tests: " +
        "say it in your own words; the builder never reads a line of a test.",
    ]);
  });

  test("a case named as holding a condition is one the tests name", () => {
    const invented = { item: "DOD-V1-2", held: true, cases: ["an invented case"] };
    assert.deepEqual(refused([], [heldBoth[0] ?? null, invented]), [
      "A case named for DOD-V1-2 is not a case the tests name. Name each case as the tests name it.",
    ]);
  });

  test("case names are read from calls of test, it and describe, in any quotes", () => {
    assert.deepEqual(caseNamesOf(testText), ["a quill that was added is counted", "an empty quill is refused"]);
    assert.deepEqual(caseNamesOf("describe(`a ${mark} group`, () => {});"), ["a ${mark} group"]);
  });

  test("one sentence is short, on one line, and has no second sentence", () => {
    assert.equal(isOneSentence("Count each quill once."), true);
    assert.equal(isOneSentence(""), false);
    assert.equal(isOneSentence("One.\nTwo."), false);
    assert.equal(isOneSentence("x".repeat(201)), false);
  });
});
