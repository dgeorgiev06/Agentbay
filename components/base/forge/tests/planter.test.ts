import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  allHeld,
  askedOf,
  bayRan,
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
} from "./kit-copy.ts";

const sample = "PLANTERNEVERSAWTHISSAMPLE";

const caughtName = "the count is one too many";

const survivorName = "the count is lost";

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

function builderLine(name: string): string {
  return `Written by the builder in .forge/worktrees/${name}.`;
}

function testsOf(name: string): Handed {
  const mark = name.toLowerCase();
  return {
    path: testPath(name),
    text: [
      `import { quill${mark} } from "../scripts/quill.ts";`,
      `const sample${mark} = "${sample}";`,
      `test("a ${mark} quill is counted once", () => quill${mark}(sample${mark}) === 1);`,
      "",
    ].join("\n"),
  };
}

function testLines(tests: readonly Handed[]): readonly string[] {
  return tests.flatMap((each) => each.text.split("\n").filter((line) => line.trim().length > 3));
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
        says: "A quill is counted once.",
        level: "must",
        proof: { kind: "fails-first", tests: [testPath(name)] },
      },
      { id: `DOD-${name}-2`, says: "The tests catch planted bugs.", level: "must", proof: { kind: "bugs-caught" } },
    ],
  };
}

function bugOf(name: string, bug: string, added: string): Json {
  const path = codeOf(name);
  const patch = [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", `-${builderLine(name)}`, `+${added}`, ""];
  return { name: bug, patch: patch.join("\n"), tests: [testPath(name)] };
}

function provedWith(name: string, bugsCaught: Json): Proved {
  return {
    verdicts: [
      { item: `DOD-${name}-1`, kind: "fails-first", verdict: "passed", detail: "It held." },
      { item: `DOD-${name}-2`, kind: "bugs-caught", ...fieldsOf(bugsCaught) },
    ],
    judgement: [],
    size: [{ path: codeOf(name), head: 1 }],
  };
}

const notKnown = { verdict: "inconclusive", reason: "No bugs were given to inject, so nothing is known." };

const survived = { verdict: "failed", detail: `A bug survived: ${survivorName}.` };

function rev(root: string, name: string): string {
  return git(root, ["rev-parse", name]).trim();
}

function stepsOf(asked: readonly Asked[]): readonly string[] {
  return asked.map((each) => `${each.action} ${each.step}`);
}

function inputOf(task: Json): Json {
  return fieldsOf(task).input ?? null;
}

async function printedCard(root: string, runId: string): Promise<readonly string[]> {
  const printed = (await bayRan(root, ["runs", runId])).stdout.split("\n");
  const first = printed.findIndex((line) => line.startsWith("Merge "));
  const last = printed.findIndex((line) => line.startsWith("hash "));
  return printed.slice(first, last);
}

type Request = {
  readonly name: string;
  readonly owner: readonly Json[];
  readonly slice?: Json;
};

async function startedAndDeclared(root: string, request: Request): Promise<string> {
  const { name, owner, slice } = request;
  const start = await started(root, {
    planned: { title: name, slice: slice ?? sliceOf(name) },
    base: shortHead(root),
    bugs: [...owner],
  });
  await declared(root, start, [codeOf(name)]);
  return start.id;
}

type WhilePlanting = {
  readonly worktrees: readonly string[];
  readonly holding: readonly string[];
  readonly testFile: boolean;
};

describe(
  "the planter writes bugs from the code and the conditions, never from the tests",
  { concurrency: true },
  () => {
    test("its task holds the code and the conditions and no line of the tests; proof gets its bugs after the owner's, and a survivor is on the card", async () => {
      const root = await project(template);
      const name = "P1";
      const tests = [testsOf(name)];
      const lines = testLines(tests);
      const owner = bugOf(name, caughtName, "Written by nobody.");
      const runId = await startedAndDeclared(root, { name, owner: [owner] });
      await provedIn(root, name, provedWith(name, notKnown));
      const planterTasks: Json[] = [];
      const whilePlanting: WhilePlanting[] = [];
      const quoting = bugOf(name, "the sample is read wrong", `const read = "${sample}";`);
      const lost = bugOf(name, survivorName, "Nothing is written.");
      const twice = bugOf(name, caughtName, "Written twice.");
      const asked = await playedTo(root, runId, {
        tests: () => Promise.resolve({ tests }),
        builder: async (given) => {
          await builderWrites(root, textAt(inputOf(given), "folder"), [codeOf(name)]);
          return { outcome: "built" };
        },
        reviewer: (given) => Promise.resolve(allHeld(given)),
        planter: async (given) => {
          planterTasks.push(given);
          whilePlanting.push({
            worktrees: worktrees(root),
            holding: await filesHolding(root, "", lines),
            testFile: existsSync(join(root, ".forge/worktrees/P1-planter", testPath(name))),
          });
          await provedIn(root, name, provedWith(name, survived));
          return { bugs: planterTasks.length === 1 ? [quoting] : [lost, twice] };
        },
      });
      assert.deepEqual(stepsOf(asked), [
        "write-tests round-1/0.call0/0#1",
        "build-without-tests round-1/0.call1/0#1",
        "review review-1/0.call1/0#1",
        "plant bugs/0.call2/0#1",
        "plant bugs/0.call2/0#2",
      ]);
      const [first, second] = planterTasks;
      assert.deepEqual(inputOf(first ?? null), {
        slice: sliceOf(name),
        interface: [],
        code: [{ path: codeOf(name), text: `${builderLine(name)}\n` }],
      });
      const shownToPlanter = JSON.stringify(planterTasks);
      assert.deepEqual(
        lines.filter(
          (line) => shownToPlanter.includes(line) || shownToPlanter.includes(JSON.stringify(line).slice(1, -1)),
        ),
        [],
      );
      assert.ok(!shownToPlanter.includes(sample));
      assert.deepEqual(fieldsOf(second ?? null).feedback, [
        "Bug 1 shares a run of 20 or more characters with the tests: write its name and its change in other words.",
      ]);
      assert.deepEqual(whilePlanting, [
        { worktrees: [".forge/worktrees/P1-planter"], holding: [], testFile: false },
        { worktrees: [".forge/worktrees/P1-planter"], holding: [], testFile: false },
      ]);
      const proved = await askedOf(root, name);
      assert.deepEqual(
        proved.map((each) => listOf(fieldsOf(each).bugs).length),
        [0, 3],
      );
      assert.deepEqual(fieldsOf(proved.at(-1) ?? null).bugs, [
        owner,
        lost,
        { ...fieldsOf(twice), name: `${caughtName} (2)` },
      ]);
      const card = waitingOf(await shown(root, runId), "card");
      assert.deepEqual(listOf(card.choices)[0], {
        name: "merge",
        status: "withheld",
        does: "Merge into the integration branch",
        reason: "1 must item failed.",
      });
      const printed = await printedCard(root, runId);
      assert.deepEqual(printed.slice(0, 7), [
        "Merge P1 into integration?",
        "  Merge is not offered: 1 must item failed.",
        "  DOD-P1-1, must, passed: A quill is counted",
        "    once.",
        "  DOD-P1-2, must, failed: The tests catch",
        "    planted bugs.",
        "  why: an injected bug survived",
      ]);
      const planted = printed.indexOf("  the planter wrote 2 bugs");
      assert.deepEqual(printed.slice(planted, planted + 3), [
        "  the planter wrote 2 bugs",
        "  bug survived: the count is lost, in",
        "    components/modes/p1/scripts/quill.ts",
      ]);
      assert.ok(printed.every((line) => Array.from(line).length <= 44));
      await decided(root, card, { step: "card", choice: "keep" });
      assert.deepEqual(branches(root), ["forge/P1", "forge/P1-planter", "forge/P1-tests-1"]);
      assert.equal(rev(root, "forge/P1-planter"), rev(root, "forge/P1"));
      assert.deepEqual(worktrees(root), []);
      assert.deepEqual(keptRows(root), []);
      assert.deepEqual(await filesHolding(root, "", lines), []);
    });

    test("a builder that stopped gets no planter: proof has the owner's bugs alone, and the kept tests are still forgotten", async () => {
      const root = await project(template);
      const name = "P2";
      const owner = bugOf(name, caughtName, "Written by nobody.");
      const runId = await startedAndDeclared(root, { name, owner: [owner, owner] });
      await provedIn(root, name, provedWith(name, notKnown));
      const keptWhileBuilding: number[] = [];
      const asked = await playedTo(root, runId, {
        tests: () => Promise.resolve({ tests: [testsOf(name)] }),
        builder: () => {
          keptWhileBuilding.push(keptRows(root).length);
          return Promise.resolve({ outcome: "stopped", missing: { lacks: "kernel", name: "worktrees.cut" } });
        },
        planter: () => Promise.reject(new Error("The planter was asked.")),
      });
      assert.deepEqual(
        asked.map((each) => each.action),
        ["write-tests", "build-without-tests"],
      );
      assert.deepEqual(keptWhileBuilding, [1]);
      const proved = await askedOf(root, name);
      assert.deepEqual(fieldsOf(proved.at(-1) ?? null).bugs, [
        owner,
        { ...fieldsOf(owner), name: `${caughtName} (2)` },
      ]);
      const printed = await printedCard(root, runId);
      assert.ok(!printed.some((line) => line.includes("planter")));
      assert.deepEqual(keptRows(root), []);
      assert.equal(
        textAt(
          runOf(await decided(root, waitingOf(await shown(root, runId), "card"), { step: "card", choice: "keep" })),
          "status",
        ),
        "done",
      );
      assert.deepEqual(worktrees(root), []);
    });

    test("a slice with no bugs-caught item gets no planter, though its rounds were done early, and the kept tests are still forgotten", async () => {
      const root = await project(template);
      const name = "P3";
      const full = fieldsOf(sliceOf(name));
      const slice = { ...full, done: listOf(full.done).slice(0, 1) };
      const runId = await startedAndDeclared(root, { name, owner: [], slice });
      await provedIn(root, name, provedWith(name, notKnown));
      const keptAtReview: number[] = [];
      const asked = await playedTo(root, runId, {
        tests: () => Promise.resolve({ tests: [testsOf(name)] }),
        builder: async (given) => {
          await builderWrites(root, textAt(inputOf(given), "folder"), [codeOf(name)]);
          return { outcome: "built" };
        },
        reviewer: (given) => {
          keptAtReview.push(keptRows(root).length);
          return Promise.resolve(allHeld(given));
        },
        planter: () => Promise.reject(new Error("The planter was asked.")),
      });
      assert.deepEqual(
        asked.map((each) => each.action),
        ["write-tests", "build-without-tests", "review"],
      );
      assert.deepEqual(keptAtReview, [1]);
      assert.deepEqual(
        (await askedOf(root, name)).map((each) => fieldsOf(each).bugs),
        [[], []],
      );
      waitingOf(await shown(root, runId), "card");
      assert.ok(!(await printedCard(root, runId)).some((line) => line.includes("planter")));
      assert.deepEqual(keptRows(root), []);
      assert.deepEqual(worktrees(root), []);
      assert.ok(!branches(root).includes("forge/P3-planter"));
    });

    test("a builder that writes a fixed test file against its rules: neither the reviewer's code nor the planter's holds it", async () => {
      const root = await project(template);
      const name = "P4";
      const runId = await startedAndDeclared(root, { name, owner: [] });
      await provedIn(root, name, provedWith(name, notKnown));
      const codeGiven: Json[] = [];
      await playedTo(root, runId, {
        tests: () => Promise.resolve({ tests: [testsOf(name)] }),
        builder: async (given) => {
          await builderWrites(root, textAt(inputOf(given), "folder"), [codeOf(name), testPath(name)]);
          return { outcome: "built" };
        },
        reviewer: (given) => {
          codeGiven.push(fieldsOf(inputOf(given)).code ?? null);
          return Promise.resolve(allHeld(given));
        },
        planter: (given) => {
          codeGiven.push(fieldsOf(inputOf(given)).code ?? null);
          return Promise.resolve({ bugs: [bugOf(name, survivorName, "Nothing is written.")] });
        },
      });
      const builderCode = [{ path: codeOf(name), text: `${builderLine(name)}\n` }];
      assert.deepEqual(codeGiven, [builderCode, builderCode]);
    });
  },
);
