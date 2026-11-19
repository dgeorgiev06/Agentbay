import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { drawn, sliceOf, type Leak } from "../scripts/lib/cards.ts";
import type { HandedTest } from "../scripts/lib/handed-tests.ts";
import { leaksFound, leaksOf, phrasesOf, sharedText, type Compared } from "../scripts/lib/leaks.ts";
import { marked, markOf, newMark, withoutMark } from "../scripts/lib/mark.ts";
import { reviewedState, reviewPlan, roundPlan, roundsStateOf, type RoundsState } from "../scripts/lib/rounds.ts";

const codePath = "components/modes/q1/scripts/quill-count.ts";

const otherPath = "components/modes/q1/scripts/ink.ts";

const testPath = "components/modes/q1/tests/quill.test.ts";

const interfacePath = "components/modes/q1/schemas/count.json";

const condition = "A quill is counted once, even when the ink is dry and the moon is full.";

const slice = sliceOf({
  name: "Q1",
  kind: "mode",
  scope: ["components/modes/q1/**"],
  after: [],
  done: [
    { id: "DOD-Q1-1", says: condition, level: "must", proof: { kind: "fails-first", tests: [testPath] } },
    { id: "DOD-Q1-2", says: "The kit's checks pass.", level: "must", proof: { kind: "checks" } },
  ],
});

const sdkImport = 'import { defineScript, fail, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";';

const assertion = 'assert.deepEqual(countQuills(sample, { strict: true }), { quills: 1, ink: "dry", moon: "full" });';

const block = [
  "const north = countQuills(sample, { strict: false, moon: 'waning', ink: 'wet' });",
  "assert.equal(north.quills + north.spilled, 3, 'the north quill spills when the ink is wet');",
  "assert.deepEqual(north.marks.map((mark) => mark.length), [12, 7, 7, 3, 1, 1, 1, 1, 1, 1]);",
];

const pathLine = `const codeFile = "${codePath}";`;

const sentenceLine = 'const says = "A quill is counted once, even when the ink is dry and the moon is full";';

const schemaLine = '"$schema": "https://json-schema.org/draft/2020-12/schema",';

const interfaceLine = '"description": "How many quills were counted, and how many spilled on the way out.",';

const baseLine = "export const quillsCountedAtTheStartOfEveryRound = startingQuills.length;";

const testText = [
  'import assert from "node:assert/strict";',
  sdkImport,
  'import { countQuills, type QuillCount } from "../scripts/quill-count.ts";',
  pathLine,
  sentenceLine,
  schemaLine,
  interfaceLine,
  baseLine,
  'test("a quill is counted once", () => {',
  `  ${assertion}`,
  ...block.map((line) => `  ${line}`),
  "  assert.equal(countQuills(sample).quills, 1);",
  "});",
  "",
].join("\n");

function compared(code: readonly HandedTest[], base: readonly HandedTest[] = []): Compared {
  const paths = [...code.map((file) => file.path), testPath, interfacePath];
  return { code, tests: [testText], phrases: phrasesOf(slice, paths), interface: [interfacePath], base };
}

function file(path: string, lines: readonly string[]): HandedTest {
  return { path, text: [...lines, ""].join("\n") };
}

describe("the shared-text rule", () => {
  test("a copied assertion line is caught, whatever its indent and spacing", () => {
    const code = file(codePath, [
      "export function countQuills() {",
      `      ${assertion.replace(", {", ",    {")}`,
      "}",
    ]);
    assert.deepEqual(sharedText(compared([code])), [{ path: codePath, lines: 1 }]);
  });

  test("a copied block is caught once per file, with the count of its lines", () => {
    const code = file(codePath, ["function check() {", ...block, ...block, "}"]);
    const other = file(otherPath, [block[0] ?? ""]);
    assert.deepEqual(sharedText(compared([code, other])), [
      { path: codePath, lines: 3 },
      { path: otherPath, lines: 1 },
    ]);
  });

  test("shared imports, a shared path, a shared function name and a condition's sentence are not caught", () => {
    const code = file(codePath, [
      sdkImport,
      pathLine,
      sentenceLine,
      "export function countQuills(sample: string, options: CountOptions): QuillCount {",
      "  return { quills: 1 };",
      "}",
    ]);
    assert.deepEqual(sharedText(compared([code])), []);
  });

  test("short common lines and a web address are not caught", () => {
    const code = file(codePath, ["});", 'import assert from "node:assert/strict";', schemaLine]);
    assert.deepEqual(sharedText(compared([code])), []);
  });

  test("a line that stands in an interface file at the base is not caught; without the base it is", () => {
    const code = file(codePath, [interfaceLine]);
    const schema = file(interfacePath, ["{", interfaceLine, "}"]);
    assert.deepEqual(sharedText(compared([code])), [{ path: codePath, lines: 1 }]);
    assert.deepEqual(sharedText(compared([code], [schema])), []);
  });

  test("a line that stood in the same file at the base is not caught; in another file it is", () => {
    const code = file(codePath, [baseLine]);
    const other = file(otherPath, [baseLine]);
    const before = file(codePath, [baseLine]);
    assert.deepEqual(sharedText(compared([code, other], [before])), [{ path: otherPath, lines: 1 }]);
  });

  test("one sentence of a condition with two is not caught on its own", () => {
    const [first] = slice.done;
    assert.ok(first !== undefined);
    const two = { ...slice, done: [{ ...first, says: `The quill is weighed first. ${condition}` }] };
    const code = file(codePath, [sentenceLine]);
    const phrases = phrasesOf(two, [codePath, testPath, interfacePath]);
    assert.deepEqual(sharedText({ ...compared([code]), phrases }), []);
  });

  test("the phrases are the conditions' sentences and the paths, lower case, none shorter than ten characters", () => {
    assert.deepEqual(phrasesOf(slice, [codePath, "a/b.ts"]), [
      "a quill is counted once, even when the ink is dry and the moon is full",
      "the kit's checks pass",
      "components/modes/q1/",
      codePath,
    ]);
  });
});

describe("the mark", () => {
  test("a new mark is 32 hex characters, and two are not the same", () => {
    const first = newMark();
    assert.match(first, /^[0-9a-f]{32}$/);
    assert.notEqual(first, newMark());
  });

  test("a marked text carries the mark on its first line, and stripping gives the text back whole", () => {
    const mark = "0123456789abcdef0123456789abcdef";
    const text = marked(testText, mark);
    assert.equal(text.split("\n")[0], `// ${mark}`);
    assert.equal(markOf(text), mark);
    assert.equal(withoutMark(text), testText);
  });

  test("a text with no mark is left as it is, and has none", () => {
    assert.equal(markOf(testText), undefined);
    assert.equal(withoutMark(testText), testText);
    assert.equal(withoutMark("// 0123\nrest"), "// 0123\nrest");
  });

  test("a file or the builder's answer holding the mark is a leak, after the file's shared lines", () => {
    const mark = "fedcba9876543210fedcba9876543210";
    const code = [file(codePath, [`const seen = "${mark}";`]), file(otherPath, ["clean"])];
    const shared = [{ path: codePath, lines: 2 }];
    assert.deepEqual(leaksFound({ shared, code, mark, answer: { outcome: "built" } }), [
      { kind: "shared-text", path: codePath, lines: 2 },
      { kind: "mark", path: codePath },
    ]);
    const answer = { outcome: "stopped", missing: { lacks: "kernel", name: `x${mark}` } };
    assert.deepEqual(leaksFound({ shared: [], code, mark, answer }), [
      { kind: "mark", path: codePath },
      { kind: "mark-in-answer" },
    ]);
    assert.deepEqual(leaksFound({ shared, code, mark: undefined, answer }), [
      { kind: "shared-text", path: codePath, lines: 2 },
    ]);
  });
});

const commit = "b".repeat(40);

const leaks: readonly Leak[] = [
  { kind: "shared-text", path: codePath, lines: 3 },
  { kind: "mark", path: otherPath },
  { kind: "mark-in-answer" },
];

const proved: RoundsState = {
  round: 1,
  stage: "proved",
  done: true,
  base: commit,
  built: { outcome: "built" },
  builder: { branch: "forge/Q1", commit },
  head: commit,
  branch: "forge/Q1-tests-1",
  folder: ".forge/worktrees/Q1-tests-1",
  declared: { files: [], names: { gained: [], lost: [], changed: [] } },
  tests: [testPath],
  verdicts: [],
  failing: { items: [], cases: [], withheld: 0, notListed: 0, notLoaded: [] },
  toBuilder: [],
  toTests: 0,
  conditions: [],
  remaining: [],
  leaks,
};

describe("a leak in the rounds' state and on the card", () => {
  test("the state reads its leaks back, and nothing else of them", () => {
    const read = roundsStateOf({ ...proved, leaks: [...leaks.map((leak) => ({ ...leak, line: "x" }))] });
    assert.deepEqual(read?.leaks, leaks);
    assert.deepEqual(leaksOf(undefined), []);
  });

  test("a leaking round is not reviewed, ends the rounds, and no later round runs", () => {
    assert.equal(reviewPlan(proved), "leaked");
    const reviewed = reviewedState(proved, { plan: "leaked" }, "review-1");
    assert.equal(reviewed.done, true);
    assert.equal(reviewed.stage, "reviewed");
    assert.deepEqual(reviewed.leaks, leaks);
    assert.equal(reviewed.folder, undefined);
    assert.equal(roundPlan(reviewed), undefined);
    assert.equal(reviewPlan(reviewed), "pass-on");
  });

  test("the card has a computed line per leak, and merge is withheld with the reason; keep is never withheld", () => {
    const proof = {
      verdicts: [
        { item: "DOD-Q1-1", kind: "fails-first" as const, verdict: "passed" as const, detail: "It held." },
        { item: "DOD-Q1-2", kind: "checks" as const, verdict: "passed" as const, detail: "It held." },
      ],
      size: [],
    };
    const input = { slice, proof, built: { outcome: "built" as const }, builtAt: "round-1", work: "forge/Q1-tests-1" };
    const result = drawn({ ...input, kept: "with-tests", into: "integration", leaks });
    assert.deepEqual(result.card.lines.slice(1, 4), [
      {
        mark: "computed",
        words: "leak: components/modes/q1/scripts/ quill-count.ts shares 3 lines with the tests",
        source: { step: "draw" },
      },
      {
        mark: "computed",
        words: `leak: ${otherPath} holds the mark planted in the tests`,
        source: { step: "draw" },
      },
      {
        mark: "computed",
        words: "leak: the builder's answer holds the mark planted in the tests",
        source: { step: "draw" },
      },
    ]);
    assert.equal(result.merge, false);
    assert.equal(result.card.withheld.merge, "The builder's work holds text from the tests.");
    assert.equal("keep" in result.card.withheld, false);
    const clean = drawn({ ...input, kept: "with-tests", into: "integration", leaks: [] });
    assert.equal(clean.merge, true);
    assert.ok(!clean.card.lines.some((line) => line.words.startsWith("leak")));
  });

  test("a leaking build whose items also failed gives both reasons", () => {
    const proof = {
      verdicts: [{ item: "DOD-Q1-1", kind: "fails-first" as const, verdict: "failed" as const, detail: "No." }],
      size: [],
    };
    const result = drawn({
      slice,
      proof,
      built: { outcome: "built" },
      builtAt: "round-1",
      work: "forge/Q1-tests-1",
      kept: "with-tests",
      into: "integration",
      leaks: [{ kind: "shared-text", path: codePath, lines: 1 }],
    });
    assert.equal(
      result.card.withheld.merge,
      "The builder's work holds text from the tests; 1 must item failed; 1 must item is not known.",
    );
    assert.equal(
      result.card.lines[1]?.words,
      "leak: components/modes/q1/scripts/ quill-count.ts shares 1 line with the tests",
    );
  });
});

test("a shared line of exactly 40 characters that are not spaces is a leak, and one of 39 is not", () => {
  const forty = `assert.equal(tally, ${"7".repeat(19)});`;
  const thirtyNine = `assert.equal(tally, ${"7".repeat(18)});`;
  const compare = (line: string): number =>
    sharedText({
      code: [{ path: "components/modes/b1/scripts/tally.ts", text: `${line}\n` }],
      tests: [`${line}\n`],
      phrases: [],
      interface: [],
      base: [],
    }).length;
  assert.equal(forty.replace(/\s/g, "").length, 40);
  assert.equal(compare(forty), 1);
  assert.equal(compare(thirtyNine), 0);
});
