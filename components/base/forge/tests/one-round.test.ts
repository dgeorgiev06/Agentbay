import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  allHeld,
  askedOf,
  assertTheMainCheckoutIsUntouched,
  bayRan,
  branches,
  builderWrites,
  decided,
  git,
  into,
  jsonOf,
  keptRows,
  kitTemplate,
  listOf,
  project,
  provedIn,
  removeAll,
  roundToCard,
  runOf,
  shortHead,
  shown,
  started,
  submitted,
  task,
  textAt,
  waitingOf,
  worktrees,
  type Handed,
  type Waiting,
} from "./kit-copy.ts";

const noNames = { gained: [], lost: [], changed: [] };

const sendBackWithheld = "no round runs after the card.";

const discardWithheld = "discarding comes with slice WD1.";

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

function testPath(name: string, file: string): string {
  return `components/modes/${name.toLowerCase()}/tests/${file}`;
}

function handed(name: string, file: string): Handed {
  const mark = `${name.toLowerCase()}${file.replace(/\W/g, "")}`;
  return {
    path: testPath(name, file),
    text: [
      `import { quillCount } from "../scripts/quill-${mark}.ts";`,
      `const ${mark}Expected = quillCount("${mark} first quill");`,
      `test("${mark}: a quill that was added is counted", () => ${mark}Expected === 1);`,
      "",
    ].join("\n"),
  };
}

function slice(name: string, tests: readonly string[]): Json {
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
        proof: { kind: "fails-first", tests: [...tests] },
      },
      { id: `DOD-${name}-2`, says: "The checks pass.", level: "must", proof: { kind: "checks" } },
    ],
  };
}

function trigger(root: string, name: string, tests: readonly string[]): Json {
  const planned = { title: `The slice ${name}`, slice: slice(name, tests) };
  const schema = `components/modes/${name.toLowerCase()}/schemas/count-request.json`;
  return { planned, base: shortHead(root), bugs: [], interface: [schema] };
}

function passed(item: string, kind: string): Json {
  return { item, kind, verdict: "passed", detail: "It held." };
}

async function allPassedIn(root: string, name: string, files: readonly string[]): Promise<void> {
  await provedIn(root, name, {
    verdicts: [
      passed(`DOD-${name}-1`, "fails-first"),
      passed(`DOD-${name}-2`, "checks"),
      passed("scope", "in-scope"),
      passed("declared", "as-declared"),
    ],
    judgement: [],
    size: files.map((path) => ({ path, head: 1 })),
  });
}

function codeOf(name: string): string {
  return `components/modes/${name.toLowerCase()}/scripts/quill.ts`;
}

function wordsOf(waiting: Waiting): readonly string[] {
  return listOf(fieldsOf(waiting.card).lines).map((line) => textAt(line, "words"));
}

function stepOf(run: Json): string {
  return textAt(fieldsOf(run).waiting ?? null, "stepKey");
}

function feedbackOf(run: Json): Json {
  return fieldsOf(fieldsOf(run).task ?? null).feedback ?? null;
}

function toolsOf(agent: { readonly [key: string]: Json }): readonly string[] {
  return listOf(agent.tools).map((tool) => (typeof tool === "string" ? tool : ""));
}

function rev(root: string, name: string): string {
  return git(root, ["rev-parse", name]).trim();
}

describe(
  "a slice that needs one round under ADR 24, from the start card to the merge card",
  { concurrency: true },
  () => {
    test("1. the whole round: merge is offered, proof judged one head with the work and the tests, and merging it lands both", async () => {
      const root = await project(template);
      const tests = [handed("R1", "quill.test.ts")];
      const files = [codeOf("R1")];
      await allPassedIn(root, "R1", [...files, tests[0]?.path ?? ""]);
      const start = await started(root, trigger(root, "R1", [testPath("R1", "quill.test.ts")]));
      const card = await roundToCard(root, start, { name: "R1", files, tests, built: { outcome: "built" } });
      assert.deepEqual(card.choices, [
        { name: "merge", status: "offered", does: "Merge into the integration branch" },
        { name: "send-back", status: "withheld", does: "A round after the card", reason: sendBackWithheld },
        { name: "keep", status: "offered", does: "Stop; the branches stay" },
        { name: "discard", status: "withheld", does: "Stop; the worktrees go", reason: discardWithheld },
      ]);
      assert.equal(wordsOf(card)[0], "2 files changed; the work and the tests are on forge/R1-tests-1");
      const head = rev(root, "forge/R1-tests-1");
      const whole = slice("R1", [testPath("R1", "quill.test.ts")]);
      const proved = {
        base: rev(root, "main"),
        head,
        declared: { files: [codeOf("R1"), testPath("R1", "quill.test.ts")], names: noNames },
        bugs: [],
      };
      const lessChecks = { ...fieldsOf(whole), done: listOf(fieldsOf(whole).done).slice(0, 1) };
      assert.deepEqual(await askedOf(root, "R1"), [
        { slice: lessChecks, ...proved },
        { slice: whole, ...proved },
      ]);
      assert.equal(git(root, ["show", `${head}:${testPath("R1", "quill.test.ts")}`]), tests[0]?.text);
      assert.equal(git(root, ["show", `${head}:${codeOf("R1")}`]), "Written by the builder in .forge/worktrees/R1.\n");
      assert.equal(rev(root, `${head}^`), rev(root, "forge/R1"));
      assert.equal(rev(root, "forge/R1^"), rev(root, "main"));
      const done = runOf(await decided(root, card, { step: "card", choice: "merge" }));
      assert.deepEqual(fieldsOf(done).output, { choice: "merge", merged: rev(root, into), into });
      assert.equal(git(root, ["show", `${into}:${testPath("R1", "quill.test.ts")}`]), tests[0]?.text);
      assert.deepEqual(branches(root), ["forge/R1", "forge/R1-merge", "forge/R1-tests-1"]);
      assert.deepEqual(worktrees(root), [".forge/worktrees/R1-merge"]);
      assert.deepEqual(keptRows(root), []);
      assertTheMainCheckoutIsUntouched(root);
    });

    test("2. a test outside the scope, or not named, is sent back by its check with only what is wrong, and round 2 is taken", async () => {
      const root = await project(template);
      const named = [testPath("R2", "first.test.ts"), testPath("R2", "second.test.ts")];
      const start = await started(root, trigger(root, "R2", named));
      await decided(root, start, { step: "start", verdict: "approve" });
      await submitted(root, start.id, { files: [codeOf("R2")], names: noNames });
      const outside = { path: "bay/quill.test.ts", text: handed("R2", "first.test.ts").text };
      const sentBack = await submitted(root, start.id, { tests: [handed("R2", "first.test.ts"), outside] });
      assert.equal(stepOf(sentBack), "round-1/0.call0/0#2");
      assert.deepEqual(feedbackOf(sentBack), [
        "The tests name a file outside the slice's write scope: bay/quill.test.ts. " +
          "Hand in only files the scope admits: components/modes/r2/**. " +
          "The tests name a file that no fails-first item names: bay/quill.test.ts. " +
          "Hand in only the named test files: components/modes/r2/tests/first.test.ts, components/modes/r2/tests/second.test.ts. " +
          "No test was handed in for components/modes/r2/tests/second.test.ts, which a fails-first item names. " +
          "Hand in every named file.",
      ]);
      const extra = handed("R2", "extra.test.ts");
      const again = await submitted(root, start.id, {
        tests: [handed("R2", "first.test.ts"), handed("R2", "second.test.ts"), extra],
      });
      assert.equal(stepOf(again), "round-1/0.call0/0#3");
      assert.deepEqual(feedbackOf(again), [
        "The tests name a file that no fails-first item names: components/modes/r2/tests/extra.test.ts. " +
          "Hand in only the named test files: components/modes/r2/tests/first.test.ts, components/modes/r2/tests/second.test.ts.",
      ]);
      assert.deepEqual(keptRows(root), []);
      const taken = await submitted(root, start.id, {
        tests: [handed("R2", "first.test.ts"), handed("R2", "second.test.ts")],
      });
      assert.equal(stepOf(taken), "round-1/0.call1/0#1");
      assert.deepEqual(
        keptRows(root).map((row) => textAt(row, "path")),
        named,
      );
      assert.deepEqual(branches(root), ["forge/R2"]);
    });

    test("3. a declaration that names a test file is sent back, and the test writer is asked only after it is taken", async () => {
      const root = await project(template);
      const named = testPath("R3", "quill.test.ts");
      const start = await started(root, trigger(root, "R3", [named]));
      await decided(root, start, { step: "start", verdict: "approve" });
      const sentBack = await submitted(root, start.id, { files: [codeOf("R3"), named], names: noNames });
      assert.equal(stepOf(sentBack), "declare/0#2");
      assert.deepEqual(feedbackOf(sentBack), [
        "The declaration names a file the builder may not change: components/modes/r3/tests/quill.test.ts. " +
          "Another agent writes the tests; leave them out.",
      ]);
      const taken = await submitted(root, start.id, { files: [codeOf("R3")], names: noNames });
      assert.equal(stepOf(taken), "round-1/0.call0/0#1");
    });

    test("4. a builder that answers stopped: the card says so first, merge is withheld, and keep keeps both branches", async () => {
      const root = await project(template);
      const tests = [handed("R4", "quill.test.ts")];
      await allPassedIn(root, "R4", [codeOf("R4")]);
      const start = await started(root, trigger(root, "R4", [testPath("R4", "quill.test.ts")]));
      const stopped = { outcome: "stopped", missing: { lacks: "kernel", name: "worktrees.commit" } };
      const card = await roundToCard(root, start, { name: "R4", files: [codeOf("R4")], tests, built: stopped });
      assert.equal(wordsOf(card)[0], "the builder stopped: the kernel lacks worktrees.commit");
      assert.deepEqual(listOf(card.choices)[0], {
        name: "merge",
        status: "withheld",
        does: "Merge into the integration branch",
        reason: "the builder stopped.",
      });
      const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
      assert.deepEqual(fieldsOf(kept).output, { choice: "keep", kept: ["forge/R4", "forge/R4-tests-1"] });
      assert.deepEqual(branches(root), ["forge/R4", "forge/R4-tests-1"]);
      assert.deepEqual(worktrees(root), []);
      assert.deepEqual(keptRows(root), []);
      assert.equal(rev(root, into), rev(root, "main"));
      assertTheMainCheckoutIsUntouched(root);
    });

    test("5. a rejected start card fails the run and leaves nothing: no branch, no worktree, no kept test", async () => {
      const root = await project(template);
      const start = await started(root, trigger(root, "R5", [testPath("R5", "quill.test.ts")]));
      const rejected = runOf(await decided(root, start, { step: "start", verdict: "reject" }));
      assert.equal(textAt(rejected, "status"), "failed");
      assert.deepEqual(branches(root), []);
      assert.deepEqual(worktrees(root), []);
      assert.deepEqual(keptRows(root), []);
      assert.equal(rev(root, into), rev(root, "main"));
      assertTheMainCheckoutIsUntouched(root);
    });

    test("6. each answer is taken by a fresh kernel: the round resumes where it waited, asks each skill once, and commits once each", async () => {
      const root = await project(template);
      const tests = [handed("R6", "quill.test.ts")];
      await allPassedIn(root, "R6", [codeOf("R6")]);
      const start = await started(root, trigger(root, "R6", [testPath("R6", "quill.test.ts")]));
      await decided(root, start, { step: "start", verdict: "approve" });
      await submitted(root, start.id, { files: [codeOf("R6")], names: noNames });
      assert.equal(stepOf(await shown(root, start.id)), "round-1/0.call0/0#1");
      await submitted(root, start.id, { tests });
      assert.equal(stepOf(await shown(root, start.id)), "round-1/0.call1/0#1");
      assert.equal(stepOf(await shown(root, start.id)), "round-1/0.call1/0#1");
      assert.equal(keptRows(root).length, 1);
      await builderWrites(root, ".forge/worktrees/R6", [codeOf("R6")]);
      const reviewing = await submitted(root, start.id, { outcome: "built" });
      assert.equal(stepOf(reviewing), "review-1/0.call1/0#1");
      assert.equal(stepOf(await shown(root, start.id)), "review-1/0.call1/0#1");
      const card = waitingOf(await submitted(root, start.id, allHeld(await task(root, start.id))), "card");
      assert.equal(git(root, ["rev-list", "--count", "main..forge/R6-tests-1"]).trim(), "2");
      assert.equal(
        git(root, ["log", "--format=%s", "-1", "forge/R6-tests-1"]).trim(),
        "R6: the tests the test writer handed in",
      );
      assert.equal(git(root, ["log", "--format=%s", "-1", "forge/R6"]).trim(), "R6: the builder's work, round 1");
      assert.deepEqual(keptRows(root), []);
      assert.equal(card.id, start.id);
    });

    test("7. a must item that failed withholds merge, and the card gives the item's reason", async () => {
      const root = await project(template);
      const tests = [handed("R7", "quill.test.ts")];
      await provedIn(root, "R7", {
        verdicts: [
          { item: "DOD-R7-1", kind: "fails-first", verdict: "failed", detail: "The named tests fail on the head." },
          passed("DOD-R7-2", "checks"),
          passed("scope", "in-scope"),
          passed("declared", "as-declared"),
        ],
        judgement: [],
        size: [{ path: codeOf("R7"), head: 1 }],
      });
      const start = await started(root, trigger(root, "R7", [testPath("R7", "quill.test.ts")]));
      const card = await roundToCard(root, start, {
        name: "R7",
        files: [codeOf("R7")],
        tests,
        built: { outcome: "built" },
      });
      assert.ok(wordsOf(card).includes("failed DOD-R7-1: the named tests fail on the head"), wordsOf(card).join("\n"));
      assert.deepEqual(listOf(card.choices)[0], {
        name: "merge",
        status: "withheld",
        does: "Merge into the integration branch",
        reason: "1 must item failed.",
      });
    });

    test("8. the test writer's and the reviewer's agents have no tool that writes, and the builder's none that runs a command", async () => {
      const root = await project(template);
      const built = await bayRan(root, ["build"]);
      assert.equal(built.status, 0, built.stdout);
      const steps = fieldsOf(jsonOf(await readFile(join(root, ".agentbay/steps.json"), "utf8")));
      const agents = fieldsOf(steps.agents ?? null);
      const builder = fieldsOf(agents["agentbay-forge-build-without-tests"] ?? null);
      for (const reader of ["agentbay-forge-write-tests", "agentbay-forge-review"]) {
        const agent = fieldsOf(agents[reader] ?? null);
        assert.deepEqual(agent.write, [], reader);
        assert.deepEqual(agent.commands, [], reader);
        assert.deepEqual(
          toolsOf(agent).filter((tool) => ["Write", "Edit", "Bash"].includes(tool)),
          [],
          reader,
        );
      }
      assert.deepEqual(builder.write, [join(root, ".forge/worktrees")]);
      assert.deepEqual(builder.commands, []);
      assert.ok(!toolsOf(builder).includes("Bash"));
    });
  },
);
