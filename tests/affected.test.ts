import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { affectedTests, repositoryTestFiles, testsThatOpenTheKit } from "./affected.ts";

const modeFolders = ["components/base/store", "components/base/proof", "components/modes/feed-briefing"];

const storeTests = ["components/base/store/tests/store-items.test.ts", "components/base/store/tests/store-sql.test.ts"];

const proofTests = [
  "components/base/proof/tests/checks.test.ts",
  "components/base/proof/tests/listed-commands.test.ts",
];

const briefingTests = ["components/modes/feed-briefing/tests/citations.test.ts"];

const kitTests = ["tests/kernel.test.ts", "tests/kit-check.test.ts", "tests/made-up-worktrees.test.ts"];

const testFiles = [...storeTests, ...proofTests, ...briefingTests, ...kitTests];

function affected(changed: readonly string[]): ReturnType<typeof affectedTests> {
  return affectedTests({ changed, testFiles, modeFolders });
}

const markersOfATestThatOpensTheKit: readonly RegExp[] = [
  /copyOfTheKit\(/,
  /\["ls-files"[^\]]*\][^)]*cwd: kit\b/s,
  /\[join\(kit, "bay", "cli\.ts"\), "(check|build)"/,
  /Folders = \[[^\]]*"components"/,
];

test("a change to one mode's script needs that mode's own tests", () => {
  assert.deepEqual(affected(["components/base/store/scripts/put.ts"]), {
    tier: "mode",
    files: storeTests,
    why: "Every changed path is inside components/base/store, and none is a manifest, schema, workflow or skill.",
  });
});

test("a change to two modes' tests needs both modes' own tests", () => {
  assert.deepEqual(
    affected([
      "components/base/store/tests/store-sql.test.ts",
      "components/modes/feed-briefing/tests/citations.test.ts",
    ]),
    {
      tier: "mode",
      files: [...storeTests, ...briefingTests],
      why:
        "Every changed path is inside components/base/store or components/modes/feed-briefing, " +
        "and none is a manifest, schema, workflow or skill.",
    },
  );
});

test("a change to a mode's mode.yaml needs its tests and every test that opens the kit", () => {
  assert.deepEqual(affected(["components/base/proof/mode.yaml"]), {
    tier: "manifest",
    files: [...proofTests, "tests/kit-check.test.ts", "tests/made-up-worktrees.test.ts"],
    why: "components/base/proof/mode.yaml is a manifest, schema, workflow or skill of a mode, so the tests that open the kit run too.",
  });
});

test("a change to a mode's schema needs its tests and every test that opens the kit", () => {
  assert.deepEqual(affected(["components/modes/feed-briefing/schemas/digest.json"]), {
    tier: "manifest",
    files: [
      "components/base/proof/tests/listed-commands.test.ts",
      ...briefingTests,
      "tests/kit-check.test.ts",
      "tests/made-up-worktrees.test.ts",
    ],
    why:
      "components/modes/feed-briefing/schemas/digest.json is a manifest, schema, workflow or skill of a mode, " +
      "so the tests that open the kit run too.",
  });
});

test("a change to a mode's workflow or a skill is a manifest change", () => {
  assert.equal(affected(["components/modes/feed-briefing/workflows/daily.yaml"]).tier, "manifest");
  assert.equal(affected(["components/modes/feed-briefing/skills/ask/SKILL.md"]).tier, "manifest");
});

test("a change to a kernel file needs the whole suite, and the reason names the file", () => {
  assert.deepEqual(affected(["components/base/store/scripts/put.ts", "bay/kernel.ts"]), {
    tier: "all",
    files: testFiles,
    why: "bay/kernel.ts is outside every mode folder, so the whole suite runs.",
  });
});

test("a change to an interface's file needs the whole suite", () => {
  assert.deepEqual(affected(["components/base/interfaces/proof.yaml"]), {
    tier: "all",
    files: testFiles,
    why: "components/base/interfaces/proof.yaml is outside every mode folder, so the whole suite runs.",
  });
});

test("a change to documents only needs no test", () => {
  assert.deepEqual(affected(["docs/briefs/AF1-the-tests-a-change-needs.md", "CONTEXT.md"]), {
    tier: "mode",
    files: [],
    why: "Only documents changed, and they need no test.",
  });
});

test("a document beside a mode's script does not raise the tier", () => {
  assert.deepEqual(
    affected(["CONTEXT.md", "components/base/store/README.md", "components/base/store/scripts/put.ts"]),
    {
      tier: "mode",
      files: storeTests,
      why: "Every changed path is inside components/base/store, and none is a manifest, schema, workflow or skill.",
    },
  );
});

test("an unknown top-level file needs the whole suite, and the reason names it", () => {
  assert.deepEqual(affected(["Makefile"]), {
    tier: "all",
    files: testFiles,
    why: "Makefile is outside every mode folder, so the whole suite runs.",
  });
});

test("a deleted test file of a mode is not run, and the mode's other tests are", () => {
  assert.deepEqual(affected(["components/base/store/tests/store-gone.test.ts"]), {
    tier: "mode",
    files: storeTests,
    why: "Every changed path is inside components/base/store, and none is a manifest, schema, workflow or skill.",
  });
});

test("a file moved from one mode to another needs both modes' tests", () => {
  assert.deepEqual(
    affected(["components/base/store/scripts/lib/rows.ts", "components/base/proof/scripts/lib/rows.ts"]),
    {
      tier: "mode",
      files: [...storeTests, ...proofTests],
      why:
        "Every changed path is inside components/base/store or components/base/proof, " +
        "and none is a manifest, schema, workflow or skill.",
    },
  );
});

test("a file moved out of a mode into the kernel needs the whole suite", () => {
  assert.equal(
    affected(["components/base/store/scripts/lib/rows.ts", "bay/rows.ts"]).why,
    `bay/rows.ts is outside every mode folder, so the whole suite runs.`,
  );
});

test("nothing changed needs no test", () => {
  assert.deepEqual(affected([]), { tier: "mode", files: [], why: "Nothing changed." });
});

test("every test file of the kit that opens the kit is on the list of tests that open the kit", () => {
  const opening = repositoryTestFiles().filter((file) => {
    const text = readFileSync(file, "utf8");
    return markersOfATestThatOpensTheKit.some((marker) => marker.test(text));
  });
  assert.ok(opening.length > 10);
  assert.deepEqual(
    opening.filter((file) => !testsThatOpenTheKit.includes(file)),
    [],
  );
});

test("every test on the list of tests that open the kit is a test file of the kit", () => {
  const files = repositoryTestFiles();
  assert.deepEqual(
    testsThatOpenTheKit.filter((file) => !files.includes(file)),
    [],
  );
});
