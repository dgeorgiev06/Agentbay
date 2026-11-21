import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { fieldsOf, readYaml } from "../../../../bay/sdk.ts";
import { cutFromDesignProblems } from "../scripts/lib/cut-from-design.ts";
import { committedFiles, designSummaryOf, modulesReached, type DesignSummary } from "../scripts/lib/design-summary.ts";
import { listOf } from "../scripts/lib/json-values.ts";
import { fixedFileProblems, type ComesAfter } from "../scripts/lib/fixed-files.ts";
import type { Plan, PlannedSlice } from "../scripts/lib/plan.ts";
import { conditionsNotHeld, unmetConditions } from "../scripts/lib/plan-conditions.ts";
import { nextFreeNumber, planDocument } from "../scripts/lib/plan-file.ts";
import { planOf, twiceNamed } from "../scripts/lib/plan-form.ts";
import { practiceProblems } from "../scripts/lib/practice-answers.ts";
import { planPractices, reviewersPractices } from "../scripts/lib/practices.ts";
import { sliceRequests } from "../scripts/lib/slice-requests.ts";
import { designFile, requirementsFile, tdOne, todoDesignFiles, todoPlan } from "./todo-plan.ts";

const schemas = "docs/designs/todo/schemas/todo";

function slice(name: string, fields: Partial<PlannedSlice> = {}): PlannedSlice {
  return { name, title: `The slice ${name}`, kind: "mode", scope: [`${name}/**`], after: [], tests: [], ...fields };
}

function plan(slices: readonly PlannedSlice[]): Plan {
  return { title: "A plan", slices };
}

function todoSummary(): DesignSummary {
  const [designed] = todoDesignFiles();
  const read = readYaml(designed?.text ?? "");
  assert.ok(read.ok);
  return designSummaryOf(designFile, read.value);
}

const conditions = { file: requirementsFile, ids: ["O1-C1", "O1-C2"] };

const never: ComesAfter = () => false;

function order(pairs: readonly (readonly [string, string])[]): ComesAfter {
  return (one, other) => pairs.some(([later, earlier]) => later === one && earlier === other);
}

describe("conditions met", () => {
  test("every condition met and none unknown is no problem", () => {
    const met = plan([slice("A", { meets: ["O1-C1"] }), slice("B", { meets: ["O1-C2"] })]);
    assert.deepEqual([...unmetConditions(met, conditions), ...conditionsNotHeld(met, conditions)], []);
  });

  test("a condition no slice meets is named once, with the file", () => {
    assert.deepEqual(
      unmetConditions(plan([slice("A", { meets: ["O1-C1"] }), slice("B")]), conditions).map(
        (problem) => problem.sentence,
      ),
      [
        "No slice meets the condition O1-C2 of docs/requirements/todo.yaml. Name it in meets of the slice that makes " +
          "it true, or add a slice for it.",
      ],
    );
  });

  test("a slice that meets a condition the requirements do not hold is named with the condition", () => {
    const problems = conditionsNotHeld(plan([slice("A", { meets: ["O1-C1", "O1-C2", "O3-C1"] })]), conditions);
    assert.deepEqual(problems, [
      {
        kind: "condition not held",
        level: "error",
        slice: "A",
        condition: "O3-C1",
        sentence:
          "A meets O3-C1, which docs/requirements/todo.yaml does not hold. Name in meets only conditions the " +
          "requirements hold.",
      },
    ]);
  });
});

describe("a slice cut from its design", () => {
  test("the design's committed files are its design file and every schema file of its actions", () => {
    const summary = todoSummary();
    assert.equal(committedFiles(summary).length, 9);
    assert.equal(committedFiles(summary)[0], designFile);
    assert.deepEqual(
      summary.modules.map((module) => [module.name, module.interfaceFiles.length]),
      [["todo", 8]],
    );
    assert.equal(summary.requirements, requirementsFile);
  });

  test("a slice reaches a module by an interface file of it, or by a file the module owns that its scope admits", () => {
    const design = {
      ...todoSummary(),
      modules: [...todoSummary().modules, { name: "archive", interfaceFiles: [], files: ["a/archive.json"] }],
    };
    assert.deepEqual(modulesReached(slice("A", { interface: [`${schemas}/add-request.json`] }), design), ["todo"]);
    assert.deepEqual(modulesReached(slice("a"), design), ["archive"]);
    assert.deepEqual(modulesReached(slice("b"), design), []);
  });

  test("each rule of the cut, with every problem at once and its sentence", () => {
    const design = {
      ...todoSummary(),
      modules: [...todoSummary().modules, { name: "archive", interfaceFiles: [], files: ["A/archive.json"] }],
    };
    const named = [`${schemas}/add-request.json`];
    const sliced = plan([
      slice("A", { meets: ["O1-C1"], interface: named }),
      slice("B", { meets: ["O1-C2"] }),
      slice("C", { meets: ["O1-C2"], interface: [`${schemas}/edit-request.json`] }),
      slice("D", { interface: named }),
      slice("E", { kind: "interface", interface: named }),
      slice("F", { kind: "capability", interface: named }),
      { ...slice("A", { meets: ["O1-C1"], interface: named }), name: "G", crossesModulesBecause: "One write." },
    ]);
    const kinds = cutFromDesignProblems(sliced, design).map((problem) => `${problem.slice} ${problem.kind}`);
    assert.deepEqual(kinds, ["A crosses modules", "B no interface", "C interface not in the design", "D not vertical"]);
  });
});

describe("fixed files made first", () => {
  const owner = slice("A", { tests: ["A/a.test.ts"], interface: ["d/a-request.json"] });

  test("a slice before the owner that names its test in its scope is told to take it out", () => {
    const early = slice("B", { scope: ["B/**", "A/a.test.ts"] });
    assert.deepEqual(
      fixedFileProblems(plan([owner, early]), order([["A", "B"]])).map((problem) => problem.sentence),
      [
        "B changes A/a.test.ts, a test it names of A, before A comes. Take A/a.test.ts out of B, or change it in " +
          "a slice after A.",
      ],
    );
  });

  test("a slice beside the owner that writes an interface file it builds against is told to come after it", () => {
    const beside = slice("B", { tests: ["d/a-request.json"] });
    assert.deepEqual(
      fixedFileProblems(plan([owner, beside]), never).map((problem) => [problem.slice, problem.owner, problem.file]),
      [["B", "A", "d/a-request.json"]],
    );
  });

  test("a slice after the owner may change its fixed files, and two slices in order may name one test", () => {
    const later = slice("B", { scope: ["B/**", "d/a-request.json"], tests: ["A/a.test.ts"] });
    assert.deepEqual(fixedFileProblems(plan([owner, later]), order([["B", "A"]])), []);
  });

  test("two slices with no order that name one test are each named", () => {
    const beside = slice("B", { tests: ["A/a.test.ts"] });
    assert.deepEqual(
      fixedFileProblems(plan([owner, beside]), never).map((problem) => `${problem.slice} ${problem.owner}`),
      ["A B", "B A"],
    );
  });

  test("a scope pattern that only admits a fixed file does not change it", () => {
    const wide = slice("B", { scope: ["A/**"] });
    assert.deepEqual(fixedFileProblems(plan([owner, wide]), never), []);
  });
});

describe("the plan file and what the rounds take from it", () => {
  test("the next free number follows the highest four-digit number, and starts at 0001", () => {
    assert.equal(
      nextFreeNumber(["0022-forge-in-waves.yaml", "0024-forge-whole.md", "0008-simplify.md", "README.md"]),
      "0025",
    );
    assert.equal(nextFreeNumber([]), "0001");
  });

  test("the plan document names its requirements and design, and its slice requests carry the plan's commit", () => {
    const named = { requirements: requirementsFile, design: designFile };
    const document = planDocument(todoPlan, named);
    assert.equal(planOf(document).design, designFile);
    assert.equal(planOf(document).requirements, requirementsFile);
    assert.deepEqual(sliceRequests(document, ["TD1"], { base: "abc1234" }), [
      {
        planned: { title: fieldsOf(tdOne).title, slice: fieldsOf(tdOne).slice },
        base: "abc1234",
        bugs: [],
        interface: fieldsOf(tdOne).interface,
      },
    ]);
  });

  test("each slice request carries the rules its actions apply: those of the actions whose request file it names", () => {
    const design = todoSummary();
    const document = planDocument(todoPlan, { requirements: requirementsFile, design: designFile });
    const [one = null, two = null] = sliceRequests(document, ["TD1", "TD2"], { base: "abc1234", design });
    const [add] = design.rules;
    assert.deepEqual(fieldsOf(one).rules, [
      {
        name: "add-todo",
        module: "todo",
        decides: "Whether a text may be added, and the id the new todo gets.",
        takes: add?.takes ?? null,
        gives: add?.gives ?? null,
        appliedBy: [{ action: "todo.add", reads: ["todos"], writes: ["todos"] }],
      },
    ]);
    assert.deepEqual(
      listOf(fieldsOf(two).rules).map((rule) => fieldsOf(rule).name),
      ["mark-done", "remove-todo"],
    );
  });

  test("two slices of one name are refused with the place of the second", () => {
    assert.deepEqual(twiceNamed(plan([slice("A"), slice("B"), slice("A")])), [
      {
        at: 2,
        sentence:
          "Slices 1 and 3 are both named A. Give each slice a name of its own, since an after names a slice by it.",
      },
    ]);
  });
});

describe("the practices held by a plan, and the challenger's answers", () => {
  test("the kit's practices held by a plan are P-33, P-34 and P-35, and a planned check is not one", async () => {
    const text = await readFile(new URL("../../../../framework/practices.md", import.meta.url), "utf8");
    assert.deepEqual(
      planPractices(text).map((practice) => practice.id),
      ["P-33", "P-34", "P-35"],
    );
    assert.ok(reviewersPractices(text).some((practice) => practice.id === "P-12"));
  });

  test("an answer that leaves a practice out, answers one not asked, or answers one twice is sent back", () => {
    const answers = [
      { id: "P-33", answer: "held", sentence: "It holds." },
      { id: "P-33", answer: "held", sentence: "It holds." },
      { id: "P-36", answer: "held", sentence: "It holds." },
    ] as const;
    assert.deepEqual(practiceProblems({ heldBy: "a plan", asked: ["P-33", "P-35"], answers }), [
      "The challenge leaves out the practice P-35; answer every practice held by a plan, each held, not-held or " +
        "does-not-apply, with its sentence.",
      "The challenge answers P-36, which is not a practice held by a plan; answer only P-33 and P-35.",
      "The challenge answers P-33 more than once; answer each practice once.",
    ]);
  });
});
