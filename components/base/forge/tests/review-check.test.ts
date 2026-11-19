import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { caseNamesOf, isOneSentence, refusedReview, type Reviewing } from "../scripts/lib/review.ts";
import {
  builderWrites,
  declared,
  filesHolding,
  kitTemplate,
  playedTo,
  project,
  provedIn,
  removeAll,
  shortHead,
  shown,
  started,
  submitted,
  task,
  textAt,
  waitingOf,
} from "./kit-copy.ts";

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
  conditions: ["DOD-V1-1", "DOD-V1-2"],
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

after(async () => {
  await removeAll();
});

test("in a run, a finding for the builder that quotes a test goes back to the reviewer with feedback that quotes nothing", async () => {
  const root = await project(await kitTemplate());
  const slice = {
    name: "V2",
    kind: "mode",
    scope: ["components/modes/v2/**"],
    after: [],
    done: [
      {
        id: "DOD-V2-1",
        says: "A quill is counted.",
        level: "must",
        proof: { kind: "fails-first", tests: [testPath.replace("v1", "v2")] },
      },
    ],
  };
  const quote = `first quill of the evening ${String(4111 * 3)}`;
  const text = testText.replace("first quill of the morning", quote).replace("quillCount", `quill${String(4111 * 5)}`);
  const tests = [{ path: testPath.replace("v1", "v2"), text }];
  await provedIn(root, "V2", {
    verdicts: [{ item: "DOD-V2-1", kind: "fails-first", verdict: "passed", detail: "It held." }],
    judgement: [],
    size: [],
  });
  const start = await started(root, { planned: { title: "V2", slice }, base: shortHead(root), bugs: [] });
  await declared(root, start, ["components/modes/v2/scripts/quill.ts"]);
  const played = await playedTo(root, start.id, {
    tests: () => Promise.resolve({ tests }),
    builder: async (given) => {
      await builderWrites(root, textAt(fieldsOf(given).input ?? null, "folder"), [
        "components/modes/v2/scripts/quill.ts",
      ]);
      return { outcome: "built" };
    },
  });
  assert.deepEqual(
    played.map((each) => each.action),
    ["write-tests", "build-without-tests"],
  );
  const conditions = [{ item: "DOD-V2-1", held: true, cases: ["a quill that was added is counted"] }];
  const quoting = forBuilder(`Count "${quote}" once.`);
  const sentBack = await submitted(root, start.id, { conditions, findings: [quoting] });
  const waiting = fieldsOf(sentBack).waiting ?? null;
  assert.equal(textAt(waiting, "stepKey"), "review-1/0.call1/0#2", JSON.stringify(sentBack));
  const feedback = fieldsOf(fieldsOf(sentBack).task ?? null).feedback;
  assert.deepEqual(feedback, [
    "Finding 1, for the builder, shares a run of 20 or more characters with the tests: " +
      "say it in your own words; the builder never reads a line of a test.",
  ]);
  assert.deepEqual(await filesHolding(root, ".agentbay", [quote]), []);
  const own = forBuilder("Count each quill once, through the count action.");
  const taken = await submitted(root, start.id, { conditions, findings: [own] });
  assert.equal(textAt(fieldsOf(taken).waiting ?? null, "stepKey"), "round-2/0.call1/0#1");
  const builderTask = JSON.stringify(await task(root, start.id));
  assert.ok(builderTask.includes("Count each quill once, through the count action."));
  assert.ok(!builderTask.includes(quote));
  assert.equal(waitingOf(await shown(root, start.id), "round-2/0.call1/0#1").id, start.id);
});
