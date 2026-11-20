import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import {
  allHeld,
  askedOf,
  branches,
  builderWrites,
  decided,
  declared,
  filesHolding,
  git,
  keptRows,
  kitTemplate,
  listOf,
  playedTo,
  project,
  provedIn,
  removeAll,
  runOf,
  shortHead,
  shown,
  started,
  textAt,
  waitingOf,
  worktrees,
  type Asked,
  type Handed,
  type Proved,
  printedCard,
} from "./kit-copy.ts";

const alphabet = Array.from({ length: 26 }, (_, at) => String.fromCharCode(65 + at)).join("");

const nineteen = `got ${alphabet.slice(0, 19)}!`;

const twenty = `got ${alphabet.slice(0, 20)}!`;

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

function testPath(name: string): string {
  return `components/modes/${name.toLowerCase()}/tests/quill.test.ts`;
}

function codeOf(name: string): string {
  return `components/modes/${name.toLowerCase()}/scripts/quill.ts`;
}

function caseName(name: string): string {
  return `${name.toLowerCase()} quill that was added is counted`;
}

function testsOf(name: string, version: number): Handed {
  const mark = `${name.toLowerCase()}v${String(version * 7)}`;
  return {
    path: testPath(name),
    text: [
      `import { quill${mark} } from "../scripts/quill-${mark}.ts";`,
      `const sample${mark} = "${alphabet}";`,
      `test("${caseName(name)}", () => quill${mark}(sample${mark}) === ${String(version)});`,
      "",
    ].join("\n"),
  };
}

function sliceOf(name: string): Json {
  return {
    name,
    kind: "mode",
    scope: [`components/modes/${name.toLowerCase()}/**`],
    after: [],
    done: [
      {
        id: `DOD-${name}-1`,
        says: "A quill that was added is counted.",
        level: "must",
        proof: { kind: "fails-first", tests: [testPath(name)] },
      },
      { id: `DOD-${name}-2`, says: "The checks pass.", level: "must", proof: { kind: "checks" } },
    ],
  };
}

function passed(name: string): Proved {
  return {
    verdicts: [
      { item: `DOD-${name}-1`, kind: "fails-first", verdict: "passed", detail: "It held." },
      { item: `DOD-${name}-2`, kind: "checks", verdict: "passed", detail: "It held." },
    ],
    judgement: [],
    size: [{ path: codeOf(name), head: 1 }],
  };
}

function failed(name: string): Proved {
  const file = `/tmp/proof-copy/${testPath(name)}`;
  return {
    verdicts: [
      {
        item: `DOD-${name}-1`,
        kind: "fails-first",
        verdict: "failed",
        detail: "The named tests fail on the head.",
        cases: {
          failures: [
            { name: caseName(name), file, message: nineteen, charactersCut: 0 },
            { name: `${caseName(name)} twice`, file, message: twenty, charactersCut: 0 },
          ],
          failuresNotListed: 0,
          notLoaded: [],
        },
      },
      { item: `DOD-${name}-2`, kind: "checks", verdict: "passed", detail: "It held." },
    ],
    judgement: [],
    size: [{ path: codeOf(name), head: 1 }],
  };
}

function inputOf(task: Json): Json {
  return fieldsOf(task).input ?? null;
}

function folderOf(task: Json): string {
  return textAt(inputOf(task), "folder");
}

function builderLine(folder: string): string {
  return `Written by the builder in ${folder}.`;
}

function rev(root: string, name: string): string {
  return git(root, ["rev-parse", name]).trim();
}

function stepsOf(asked: readonly Asked[]): readonly string[] {
  return asked.map((each) => `${each.action} ${each.step}`);
}

type Seen = {
  readonly holding: readonly string[];
  readonly inTask: boolean;
};

async function seenBy(root: string, task: Json, lines: readonly string[]): Promise<Seen> {
  const shown = JSON.stringify(task);
  return {
    holding: await filesHolding(root, "", lines),
    inTask: lines.some((line) => shown.includes(line) || shown.includes(JSON.stringify(line).slice(1, -1))),
  };
}

function testLines(tests: readonly Handed[]): readonly string[] {
  return tests.flatMap((each) => each.text.split("\n").filter((line) => line.trim().length > 3));
}

describe("a slice's rounds, two and three, with the reviewer", { concurrency: true }, () => {
  test("the workflow has three rounds and three reviews, written out as steps, and no fourth", async () => {
    const text = await readFile(new URL("../workflows/rounds.yaml", import.meta.url), "utf8");
    const read = readYaml(text);
    assert.ok(read.ok);
    const ids = listOf(fieldsOf(read.value).steps).map((step) => textAt(step, "id"));
    assert.deepEqual(
      ids.filter((id) => /^(round|review)-/.test(id)),
      ["round-1", "review-1", "round-2", "review-2", "round-3", "review-3"],
    );
  });

  test("tests that fail in round 1 go back to the builder as names, and messages that quote no test; they pass in round 2", async () => {
    const root = await project(template);
    const name = "A1";
    const tests = [testsOf(name, 1)];
    const lines = testLines(tests);
    const start = await started(root, {
      planned: { title: "A1", slice: sliceOf(name) },
      base: shortHead(root),
      bugs: [],
    });
    await declared(root, start, [codeOf(name)]);
    const whileBuilding: Seen[] = [];
    const builderTasks: Json[] = [];
    const reviewerTasks: Json[] = [];
    const resumed: string[] = [];
    const testFileInFolder: boolean[] = [];
    const asked = await playedTo(root, start.id, {
      tests: () => Promise.resolve({ tests }),
      builder: async (given) => {
        builderTasks.push(given);
        const folder = folderOf(given);
        resumed.push(textAt(fieldsOf(await shown(root, start.id)).waiting ?? null, "stepKey"));
        whileBuilding.push(await seenBy(root, given, lines));
        testFileInFolder.push(existsSync(join(root, folder, testPath(name))));
        await builderWrites(root, folder, [codeOf(name)]);
        await provedIn(root, name, builderTasks.length === 1 ? failed(name) : passed(name));
        return { outcome: "built" };
      },
      reviewer: (given) => {
        reviewerTasks.push(given);
        return Promise.resolve(allHeld(given));
      },
    });
    assert.deepEqual(stepsOf(asked), [
      "write-tests round-1/0.call0/0#1",
      "build-without-tests round-1/0.call1/0#1",
      "build-without-tests round-2/0.call1/0#1",
      "review review-2/0.call1/0#1",
    ]);
    assert.deepEqual(resumed, ["round-1/0.call1/0#1", "round-2/0.call1/0#1"]);
    assert.deepEqual(whileBuilding, [
      { holding: [], inTask: false },
      { holding: [], inTask: false },
    ]);
    assert.deepEqual(testFileInFolder, [false, false]);
    const [first, second] = builderTasks.map(inputOf);
    assert.equal(fieldsOf(first ?? null).failing, undefined);
    assert.equal(textAt(second ?? null, "folder"), ".forge/worktrees/A1-2");
    assert.deepEqual(fieldsOf(second ?? null).findings, []);
    assert.deepEqual(fieldsOf(second ?? null).failing, {
      items: ["DOD-A1-1"],
      cases: [
        { name: caseName(name), file: testPath(name), message: nineteen },
        { name: `${caseName(name)} twice`, file: testPath(name) },
      ],
      withheld: 1,
      notListed: 0,
      notLoaded: [],
    });
    assert.ok(!JSON.stringify(builderTasks).includes(twenty));
    const [review] = reviewerTasks.map(inputOf);
    assert.deepEqual(fieldsOf(review ?? null).tests, tests);
    assert.deepEqual(fieldsOf(review ?? null).code, [
      { path: codeOf(name), text: `${builderLine(".forge/worktrees/A1-2")}\n` },
    ]);
    const practices = listOf(fieldsOf(review ?? null).practices).map((practice) => textAt(practice, "id"));
    assert.ok(practices.includes("P-03") && practices.includes("TS-21") && !practices.includes("P-01"));
    const card = waitingOf(await shown(root, start.id), "card");
    assert.equal(listOf(card.choices).map((choice) => textAt(choice, "status"))[0], "offered");
    const heads = (await askedOf(root, name)).map((each) => textAt(each, "head"));
    assert.deepEqual(heads, [
      rev(root, "forge/A1-tests-1"),
      rev(root, "forge/A1-tests-2"),
      rev(root, "forge/A1-tests-2"),
    ]);
    assert.equal(rev(root, "forge/A1-tests-2^"), rev(root, "forge/A1-2"));
    assert.equal(git(root, ["show", `forge/A1-2:${codeOf(name)}`]), `${builderLine(".forge/worktrees/A1-2")}\n`);
    assert.deepEqual(await printedCard(root, start.id), [
      "Merge A1 into integration?",
      "  Merge is offered: every must item that",
      "    proof judged passed.",
      "  DOD-A1-1, must, passed: A quill that was",
      "    added is counted.",
      "  DOD-A1-2, must, passed: The checks pass.",
      "  1 file changed; the work and the tests are",
      "    on forge/A1-tests-2",
      "  size in lines: components/ +1",
      "  rounds: 2 of at most 3; the reviewer had",
      "    no findings",
      "  the reviewer, in round 2, before the final",
      "    proof:",
      "judged   DOD-A1-1 held by 1 case",
      "judged   DOD-A1-2 held by 1 case",
      "judged   no finding remains",
      "judged    by forge skills/review, tier deep",
      "Unmarked lines were worked out by script.",
      "You can:",
      "  merge  Merge into the integration branch",
      "  keep   Stop; the branches stay",
      "Not available:",
      "  send-back  A round after the card",
      "             why: No round runs after the",
      "             card.",
      "  discard    Stop; the worktrees go",
      "             why: Discarding comes with",
      "             slice WD1.",
      "checked: 0 ran, 7 computed, 3 judged",
    ]);
    await decided(root, card, { step: "card", choice: "merge" });
    assert.deepEqual(branches(root), [
      "forge/A1",
      "forge/A1-2",
      "forge/A1-merge",
      "forge/A1-tests-1",
      "forge/A1-tests-2",
    ]);
    assert.deepEqual(worktrees(root), [".forge/worktrees/A1-merge"]);
    assert.deepEqual(keptRows(root), []);
    assert.deepEqual(await filesHolding(root, ".forge/worktrees/A1-merge", lines), [
      `.forge/worktrees/A1-merge/${testPath(name)}`,
    ]);
    assert.deepEqual(await filesHolding(root, ".agentbay", lines), []);
  });

  test("a slice still failing after round 3 reaches the card with merge withheld, and the reviewer's verdicts are judged lines", async () => {
    const root = await project(template);
    const name = "B1";
    const tests = [testsOf(name, 1)];
    const lines = testLines(tests);
    const start = await started(root, {
      planned: { title: "B1", slice: sliceOf(name) },
      base: shortHead(root),
      bugs: [],
    });
    await declared(root, start, [codeOf(name)]);
    await provedIn(root, name, failed(name));
    const whileBuilding: string[][] = [];
    const asked = await playedTo(root, start.id, {
      tests: () => Promise.resolve({ tests }),
      builder: async (given) => {
        whileBuilding.push([...(await filesHolding(root, "", lines))]);
        await builderWrites(root, folderOf(given), [codeOf(name)]);
        return { outcome: "built" };
      },
      reviewer: () =>
        Promise.resolve({
          conditions: [
            { item: "DOD-B1-1", held: false, why: "The count is off by one for every quill." },
            { item: "DOD-B1-2", held: true, cases: [caseName(name)] },
          ],
          findings: [
            { to: "builder", case: caseName(name), question: "condition", fix: "Count each quill once." },
            { to: "test-writer", case: caseName(name), question: "Q3", fix: `Compare with "${alphabet}" literally.` },
          ],
        }),
    });
    assert.deepEqual(stepsOf(asked), [
      "write-tests round-1/0.call0/0#1",
      "build-without-tests round-1/0.call1/0#1",
      "build-without-tests round-2/0.call1/0#1",
      "build-without-tests round-3/0.call1/0#1",
      "review review-3/0.call1/0#1",
    ]);
    assert.deepEqual(whileBuilding, [[], [], []]);
    const card = waitingOf(await shown(root, start.id), "card");
    assert.deepEqual(listOf(card.choices)[0], {
      name: "merge",
      status: "withheld",
      does: "Merge into the integration branch",
      reason: "1 must item failed.",
    });
    assert.deepEqual(await printedCard(root, start.id), [
      "Merge B1 into integration?",
      "  Merge is not offered: 1 must item failed.",
      "  DOD-B1-1, must, failed: A quill that was",
      "    added is counted.",
      "  why: the named tests fail on the head",
      "  proof's reason: The named tests fail on",
      "    the head.",
      "  failing: b1 quill that was added is",
      "    counted",
      `  its message: ${nineteen}`,
      "  failing: b1 quill that was added is",
      "    counted twice",
      "  DOD-B1-2, must, passed: The checks pass.",
      "  1 file changed; the work and the tests are",
      "    on forge/B1-tests-3",
      "  size in lines: components/ +1",
      "  rounds: 3 of at most 3; no more may run",
      "  the reviewer, in round 3, before the final",
      "    proof:",
      "judged   DOD-B1-1 not held: The count is off",
      "judged     by one for every quill.",
      "judged   DOD-B1-2 held by 1 case",
      "judged   2 findings remain: 1 for the",
      "judged     builder, 1 for the test writer",
      "judged   for the builder, condition: Count",
      "judged     each quill once.",
      "judged   for the test writer, Q3, b1 quill",
      "judged     that was added is counted: kept",
      "judged     from the card: it quotes a test",
      "judged    by forge skills/review, tier deep",
      "Unmarked lines were worked out by script.",
      "You can:",
      "  keep  Stop; the branches stay",
      "Not available:",
      "  merge      Merge into the integration",
      "             branch",
      "             why: 1 must item failed.",
      "  send-back  A round after the card",
      "             why: No round runs after the",
      "             card.",
      "  discard    Stop; the worktrees go",
      "             why: Discarding comes with",
      "             slice WD1.",
      "checked: 0 ran, 12 computed, 5 judged",
    ]);
    const kernel = await readFile(join(root, ".agentbay/kernel.db"));
    assert.ok(!kernel.toString("latin1").includes(alphabet));
    const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
    assert.deepEqual(fieldsOf(kept).output, { choice: "keep", kept: ["forge/B1", "forge/B1-tests-3"] });
    assert.deepEqual(branches(root), [
      "forge/B1",
      "forge/B1-2",
      "forge/B1-3",
      "forge/B1-tests-1",
      "forge/B1-tests-2",
      "forge/B1-tests-3",
    ]);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(keptRows(root), []);
    assert.deepEqual(await filesHolding(root, "", lines), []);
  });

  test("a finding for the test writer changes the tests in rounds 2 and 3; the test writer never reads the builder's code, the builder never the tests", async () => {
    const root = await project(template);
    const name = "C1";
    const versions = [testsOf(name, 1), testsOf(name, 2), testsOf(name, 3)];
    const allTestLines = testLines(versions);
    const start = await started(root, {
      planned: { title: "C1", slice: sliceOf(name) },
      base: shortHead(root),
      bugs: [],
    });
    await declared(root, start, [codeOf(name)]);
    await provedIn(root, name, passed(name));
    const builderLines: string[] = [];
    const writerSaw: Seen[] = [];
    const builderSaw: Seen[] = [];
    const writerTasks: Json[] = [];
    const builderTasks: Json[] = [];
    const quotingFix = `Assert "${alphabet}" against a literal count.`;
    const reviews = [
      [
        { to: "test-writer", case: caseName(name), question: "Q3", fix: quotingFix },
        { to: "builder", case: caseName(name), question: "P-05", fix: "Keep the count a whole number." },
      ],
      [{ to: "test-writer", case: caseName(name), question: "Q5", fix: "Add a case for no quill." }],
      [],
    ];
    const asked = await playedTo(root, start.id, {
      tests: async (given) => {
        writerTasks.push(given);
        if (writerTasks.length > 1) {
          writerSaw.push(await seenBy(root, given, builderLines));
        }
        return { tests: [versions[writerTasks.length - 1] ?? testsOf(name, 0)] };
      },
      builder: async (given) => {
        builderTasks.push(given);
        builderSaw.push(await seenBy(root, given, [...allTestLines, quotingFix]));
        const folder = folderOf(given);
        builderLines.push(builderLine(folder));
        await builderWrites(root, folder, [codeOf(name)]);
        return {
          outcome: "built",
          decisions: [`The count is kept as a whole number, round ${String(builderTasks.length)}.`],
        };
      },
      reviewer: (given) => {
        const findings = reviews.shift() ?? [];
        return Promise.resolve({ ...fieldsOf(allHeld(given)), findings });
      },
    });
    assert.deepEqual(stepsOf(asked), [
      "write-tests round-1/0.call0/0#1",
      "build-without-tests round-1/0.call1/0#1",
      "review review-1/0.call1/0#1",
      "write-tests round-2/0.call1/0#1",
      "build-without-tests round-2/0.call4/0#1",
      "review review-2/0.call1/0#1",
      "write-tests round-3/0.call1/0#1",
      "review review-3/0.call1/0#1",
    ]);
    assert.deepEqual(writerSaw, [
      { holding: [], inTask: false },
      { holding: [], inTask: false },
    ]);
    assert.deepEqual(builderSaw, [
      { holding: [], inTask: false },
      { holding: [], inTask: false },
    ]);
    const [, second, third] = writerTasks.map(inputOf);
    assert.equal(textAt(second ?? null, "folder"), ".forge/worktrees/C1-writer-2");
    assert.deepEqual(fieldsOf(second ?? null).earlier, [versions[0]]);
    assert.deepEqual(fieldsOf(second ?? null).findings, [
      { to: "test-writer", case: caseName(name), question: "Q3", fix: quotingFix },
    ]);
    assert.deepEqual(fieldsOf(third ?? null).earlier, [versions[1]]);
    assert.deepEqual(fieldsOf(builderTasks.map(inputOf)[1] ?? null).findings, [
      { to: "builder", case: caseName(name), question: "P-05", fix: "Keep the count a whole number." },
    ]);
    const head = rev(root, "forge/C1-tests-3");
    assert.equal(git(root, ["show", `${head}:${testPath(name)}`]), versions[2]?.text);
    assert.equal(rev(root, `${head}^`), rev(root, "forge/C1-2"));
    const card = waitingOf(await shown(root, start.id), "card");
    assert.equal(listOf(card.choices).map((choice) => textAt(choice, "status"))[0], "offered");
    const printed = await printedCard(root, start.id);
    const decided = printed.indexOf("judged   the builder decided: The count is");
    assert.deepEqual(printed.slice(decided, decided + 4), [
      "judged   the builder decided: The count is",
      "judged     kept as a whole number, round 2.",
      "judged    by forge skills/write-tests, tier",
      "judged      balanced; forge",
    ]);
    assert.equal(printed[decided + 4], "judged      skills/build-without-tests, tier");
    assert.ok(!branches(root).some((branch) => branch.includes("writer")));
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(keptRows(root), []);
  });
});

test("the tests' text and the builder's code are in no file a later step could read as text: the kernel keeps the reviewer's task packed", async () => {
  const root = await project(template);
  const name = "E1";
  const tests = [testsOf(name, 1)];
  const start = await started(root, {
    planned: { title: "E1", slice: sliceOf(name) },
    base: shortHead(root),
    bugs: [],
  });
  await declared(root, start, [codeOf(name)]);
  await provedIn(root, name, passed(name));
  let atReview: readonly string[] = [];
  await playedTo(root, start.id, {
    tests: () => Promise.resolve({ tests }),
    builder: async (given) => {
      await builderWrites(root, folderOf(given), [codeOf(name)]);
      return { outcome: "built" };
    },
    reviewer: async (given) => {
      atReview = await filesHolding(root, ".agentbay", [...testLines(tests), builderLine(".forge/worktrees/E1")]);
      return allHeld(given);
    },
  });
  assert.deepEqual(atReview, []);
  const kernel = await readFile(join(root, ".agentbay/kernel.db"));
  assert.ok(!kernel.toString("latin1").includes(alphabet));
});
