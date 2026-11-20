import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "../../../../bay/sdk.ts";
import { bugsOnCard } from "../scripts/lib/bug-card.ts";
import { drawn, type MergeCardInput } from "../scripts/lib/merge-card.ts";
import type { Verdict } from "../scripts/lib/proof-answer.ts";
import { sliceOf } from "../scripts/lib/slice-form.ts";
import { bugsHanded, bugsOf, patchedFiles, plants, refusedBugs, type Bug } from "../scripts/lib/planting.ts";

const codePath = "components/modes/p1/scripts/quill.ts";

const otherCode = "components/modes/p1/scripts/count.ts";

const testPath = "components/modes/p1/tests/quill.test.ts";

const quoted = "first quill of the morning";

const testText = [
  'import { quillCount } from "../scripts/quill.ts";',
  'test("a quill that was added is counted", () => {',
  `  assert.equal(quillCount("${quoted}"), 1);`,
  "});",
  "",
].join("\n");

const planting = {
  code: [codePath, otherCode],
  fixed: [testPath],
  tests: [{ path: testPath, text: testText }],
};

function patchOf(path: string, added: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-  return count;",
    `+${added}`,
    "",
  ].join("\n");
}

function bugIn(path: string, name: string, added = "  return count + 1;"): Bug {
  return { name, patch: patchOf(path, added), tests: [testPath] };
}

function refused(bugs: readonly Json[]): readonly string[] {
  return refusedBugs({ bugs: [...bugs] }, planting);
}

const slice = sliceOf({
  name: "P1",
  kind: "mode",
  scope: ["components/modes/p1/**"],
  after: [],
  done: [
    { id: "DOD-P1-1", says: "A quill is counted.", level: "must", proof: { kind: "fails-first", tests: [testPath] } },
    { id: "DOD-P1-2", says: "The tests catch planted bugs.", level: "must", proof: { kind: "bugs-caught" } },
  ],
});

describe("the planter's answer, as the check sees it", () => {
  test("bugs in the builder's code, each caught by a named test, are taken", () => {
    assert.deepEqual(
      refused([bugIn(codePath, "the count is one too many"), bugIn(otherCode, "the count is lost")]),
      [],
    );
  });

  test("a bug in a test file, and one in a file the builder did not change, are refused by number", () => {
    const inTest = bugIn(testPath, "the test is changed");
    const elsewhere = bugIn("bay/sdk.ts", "the toolbox is changed");
    assert.deepEqual(refused([inTest, elsewhere]), [
      "Bug 1 changes a test file; plant bugs only in the builder's code.",
      "Bug 2 changes bay/sdk.ts, which the builder did not change; plant bugs only in the files given as code.",
    ]);
  });

  test("a patch that names no file is refused", () => {
    const bare = { name: "no file at all", patch: "@@ -1 +1 @@\n-a\n+b\n", tests: [testPath] };
    assert.deepEqual(refused([bare]), [
      "Bug 1 changes no file: write its patch as git diff writes it, against the builder's code.",
    ]);
  });

  test("a bug that names a test file no fails-first item names is refused", () => {
    const named = {
      ...bugIn(codePath, "the count is one too many"),
      tests: ["components/modes/p1/tests/other.test.ts"],
    };
    assert.deepEqual(refused([named]), [
      "Bug 1 names components/modes/p1/tests/other.test.ts among its tests, which no fails-first item names; " +
        `name only these: ${testPath}.`,
    ]);
  });

  test("a bug whose change or name quotes a test is refused, and the feedback quotes nothing of the tests", () => {
    const changed = bugIn(codePath, "the morning quill", `  return quillCount("${quoted}") + 1;`);
    const named = bugIn(codePath, `counts ${quoted} twice`);
    const feedback = refused([bugIn(codePath, "the count is one too many"), changed, named]);
    assert.deepEqual(feedback, [
      "Bug 2 shares a run of 20 or more characters with the tests: write its name and its change in other words.",
      "Bug 3 shares a run of 20 or more characters with the tests: write its name and its change in other words.",
    ]);
    assert.ok(!feedback.join(" ").includes("quill of"));
  });

  test("a removed line that matches a test is not a quote: only what the bug writes is checked", () => {
    const patch = [
      `--- a/${codePath}`,
      `+++ b/${codePath}`,
      "@@ -1 +1 @@",
      `-  return quillCount("${quoted}");`,
      "+  return 0;",
      "",
    ].join("\n");
    assert.deepEqual(refused([{ name: "the count is always none", patch, tests: [testPath] }]), []);
  });

  test("a patch's file lines are not what the bug writes: a test that names the file does not refuse the bug", () => {
    const naming = { ...planting, tests: [{ path: testPath, text: `import { quillCount } from "${codePath}";\n` }] };
    assert.deepEqual(refusedBugs({ bugs: [bugIn(codePath, "the count is one too many")] }, naming), []);
  });

  test("ten bugs are taken and eleven refused", () => {
    const bugs = Array.from({ length: 11 }, (_, at) => bugIn(codePath, `bug number ${String(at + 1)}`));
    assert.deepEqual(refused(bugs.slice(0, 10)), []);
    assert.deepEqual(refused(bugs), [
      "The answer gives 11 bugs; give at most 10, those the tests are likeliest to miss.",
    ]);
  });

  test("two bugs of one name are refused by their numbers", () => {
    const bugs = [bugIn(codePath, "the same"), bugIn(otherCode, "another"), bugIn(otherCode, "the same")];
    assert.deepEqual(refused(bugs), ["Bugs 1 and 3 have the same name; give each bug a name of its own."]);
  });
});

describe("the files a patch changes", () => {
  test("a git patch names each file once, a new file by its new path, and never /dev/null", () => {
    const created = [
      "diff --git a/x.ts b/x.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/x.ts",
      "@@ -0,0 +1 @@",
      "+a",
    ];
    assert.deepEqual(patchedFiles([...created, patchOf(codePath, "b")].join("\n")), ["x.ts", codePath]);
  });

  test("a patch with only its --- and +++ lines names its file", () => {
    assert.deepEqual(patchedFiles(`--- a/${codePath}\n+++ b/${codePath}\n@@ -1 +1 @@\n-a\n+b\n`), [codePath]);
  });
});

describe("the bugs handed to proof", () => {
  const owner = bugIn(codePath, "the count is one too many");

  test("the owner's come first, then the planter's, and a name used twice is made distinct", () => {
    const planted = [bugIn(otherCode, "the count is one too many"), bugIn(otherCode, "the count is one too many (2)")];
    assert.deepEqual(
      bugsHanded([owner], planted).map((bug) => bug.name),
      ["the count is one too many", "the count is one too many (2)", "the count is one too many (2) (2)"],
    );
    assert.deepEqual(
      bugsHanded([owner], [owner, owner]).map((bug) => bug.name),
      ["the count is one too many", "the count is one too many (2)", "the count is one too many (3)"],
    );
    assert.deepEqual(bugsHanded([owner], planted)[1]?.patch, planted[0]?.patch);
  });

  test("a long name made distinct stays at most 200 characters", () => {
    const long = bugIn(codePath, "x".repeat(200));
    const [, second] = bugsHanded([long], [long]);
    assert.equal(second?.name, `${"x".repeat(196)} (2)`);
  });

  test("at most 50 bugs reach proof, the owner's first", () => {
    const owners = Array.from({ length: 45 }, (_, at) => bugIn(codePath, `owner ${String(at)}`));
    const planted = Array.from({ length: 10 }, (_, at) => bugIn(codePath, `planter ${String(at)}`));
    const handed = bugsHanded(owners, planted);
    assert.equal(handed.length, 50);
    assert.equal(handed[44]?.name, "owner 44");
    assert.equal(handed[49]?.name, "planter 4");
  });

  test("bugs are read with their name, patch and tests, and nothing else", () => {
    assert.deepEqual(bugsOf([{ ...owner, extra: "no" }, "not a bug"]), [owner, { name: "", patch: "", tests: [] }]);
  });
});

describe("when the planter runs", () => {
  test("only for a slice with a bugs-caught item whose builder built it and leaked nothing", () => {
    const missing = { lacks: "kernel" as const, name: "worktrees.cut" };
    const built = { outcome: "built" as const };
    assert.equal(plants(slice, { built, leaks: [] }), true);
    assert.equal(plants(slice, { built: { outcome: "stopped", missing }, leaks: [] }), false);
    assert.equal(plants({ ...slice, done: slice.done.slice(0, 1) }, { built, leaks: [] }), false);
    assert.equal(plants(slice, { built, leaks: [{ kind: "mark-in-answer" }] }), false);
  });
});

describe("the merge card's lines for the bugs", () => {
  const survivor = bugIn(otherCode, "the count is lost");
  const caught = bugIn(codePath, "the count is one too many");
  const verdicts: readonly Verdict[] = [
    { item: "DOD-P1-1", kind: "fails-first", verdict: "passed", detail: "It held." },
    { item: "DOD-P1-2", kind: "bugs-caught", verdict: "failed", detail: "A bug survived: the count is lost." },
  ];

  function cardOf(bugs: readonly Bug[], planted: number, said: readonly Verdict[] = verdicts): MergeCardInput {
    return {
      slice,
      proof: { verdicts: said, size: [] },
      built: { outcome: "built" },
      builtAt: "round-1",
      work: "forge/P1-tests-3",
      kept: "with-tests",
      caseMessages: "filtered",
      into: "integration",
      bugs: bugsOnCard(bugs, said, planted),
    };
  }

  test("a bug that survived is named with its file on a computed line, and the planter's count is said", () => {
    const lines = drawn(cardOf([caught, survivor], 2)).card.lines;
    assert.deepEqual(lines.slice(-2), [
      { mark: "computed", words: "the planter wrote 2 bugs", source: { step: "draw" } },
      { mark: "computed", words: `bug survived: the count is lost, in ${otherCode}`, source: { step: "draw" } },
    ]);
    assert.ok(lines.every((line) => !line.words.includes("return count")));
  });

  test("with no planter, no count is said; with every bug caught, no bug is named", () => {
    const passed: readonly Verdict[] = [
      { item: "DOD-P1-2", kind: "bugs-caught", verdict: "passed", detail: "A bug survived: the count is lost." },
    ];
    const words = (input: MergeCardInput): readonly string[] => drawn(input).card.lines.map((line) => line.words);
    assert.deepEqual(words(cardOf([caught, survivor], 1)).at(-2), "the planter wrote 1 bug");
    assert.ok(!words(cardOf([caught, survivor], 0)).some((said) => said.startsWith("the planter")));
    assert.ok(!words(cardOf([caught, survivor], 2, passed)).some((said) => said.startsWith("bug survived")));
  });

  test("a bug whose name only begins another survivor's name is not named", () => {
    const short = bugIn(codePath, "the count");
    assert.deepEqual(bugsOnCard([short, survivor], verdicts, 0), {
      planted: 0,
      survived: [{ name: "the count is lost", files: [otherCode] }],
    });
  });
});
