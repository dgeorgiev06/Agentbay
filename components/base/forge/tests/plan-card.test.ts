import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { planCard, type PlanCardInput } from "../scripts/lib/plan-card.ts";
import { planChanges } from "../scripts/lib/plan-changes.ts";
import { planDocument } from "../scripts/lib/plan-file.ts";
import { planOf } from "../scripts/lib/plan-form.ts";
import { sourcesGiven } from "../scripts/lib/plan-sources.ts";
import { workOut } from "../scripts/lib/plan-waves.ts";
import type { PracticeAnswer } from "../scripts/lib/practice-answers.ts";
import { printed } from "./printed-card.ts";
import { designFile, requirementsFile, tdOne, tdTwo, todoDesignFiles, todoPlan } from "./todo-plan.ts";

const skills = {
  "plan-1": "forge skills/plan, tier balanced",
  "plan-2": "forge skills/plan, tier balanced",
  "challenge-1": "forge skills/challenge-plan, tier deep",
  "challenge-2": "forge skills/challenge-plan, tier deep",
};

const allHeld: readonly PracticeAnswer[] = [
  { id: "P-33", answer: "held", sentence: "Each slice can be seen working on its own." },
  { id: "P-34", answer: "held", sentence: "Each slice changes only the todo mode's folder." },
  { id: "P-35", answer: "held", sentence: "The interface was committed by the design." },
];

const p34NotHeld: readonly PracticeAnswer[] = [
  { id: "P-33", answer: "held", sentence: "Each slice can be seen working on its own." },
  { id: "P-34", answer: "not-held", sentence: "TD2 writes the folder TD1 makes." },
  { id: "P-35", answer: "held", sentence: "The interface was committed by the design." },
];

async function todoInput(plan: Json): Promise<PlanCardInput> {
  const read = readYaml(await readFile(new URL(`../../../../${requirementsFile}`, import.meta.url), "utf8"));
  assert.ok(read.ok);
  const [designed] = todoDesignFiles();
  const parsed = readYaml(designed?.text ?? "");
  assert.ok(parsed.ok);
  const document = parsed.value;
  const sources = sourcesGiven({ file: requirementsFile, requirements: read.value, design: designFile, document });
  const planned = planOf(planDocument(plan, { requirements: requirementsFile, design: designFile }));
  return {
    job: "todo",
    into: "integration",
    design: sources.design,
    conditions: sources.conditions,
    plan: planned,
    workedOut: workOut(planned, [], sources),
    practices: allHeld,
    findings: [],
    challenger: "challenge-1",
    answer: { kind: "not asked" },
  };
}

function printedPlan(input: PlanCardInput): string {
  const drawn = planCard(input);
  const reason = drawn.card.withheld.approve;
  const approve = { name: "approve", does: "Commit the plan" };
  const choices = [reason === undefined ? approve : { ...approve, withheld: reason }];
  return printed(drawn.card, [...choices, { name: "stop", does: "Stop; nothing is committed" }], { skills });
}

const todoCard = `Commit the plan for todo?
  2 slices in 2 waves; longest chain: TD1,
    TD2; approve is offered
  cut from docs/designs/todo/design.yaml and
    docs/requirements/todo.yaml: 13
    conditions
  wave 1: TD1, module todo; meets O1-C1,
    O1-C2, O1-C3, O1-C4, O1-C5, O1-C6, O1-C7
judged   TD1: A todo mode that adds a todo
judged     and lists the open ones
judged    by forge skills/plan, tier
judged      balanced
  wave 2: TD2, module todo; meets O2-C1,
    O2-C2, O2-C3, O2-C4, O2-C5, O2-C6
judged   TD2: The todo mode marks a todo
judged     done and removes one
judged    by forge skills/plan, tier
judged      balanced
  TD2 after TD1: It adds two actions to the
    mode TD1 makes.
  one after another because: Both slices
    write the one mode's folder, and the
    second adds to what the first makes.
  every condition met: yes
  fixed files made first: yes; 8 interface
    files by the design, 2 test files by
    their slices
  checked by script, as forge.waves checks a
    plan: no problem
  the planner was not asked again, since the
    challenge found nothing
  practices held by the script's checks:
    P-33, P-34 and P-35
  practices answered by the challenger: 3; 3
    held, 0 not held, 0 do not apply
  findings left after the planner's answer:
    none
  approve commits it into integration as
    docs/plans/NNNN-todo.yaml, NNNN the next
    free number
Unmarked lines were worked out by script.
You can:
  approve  Commit the plan
  stop     Stop; nothing is committed
checked: 0 ran, 14 computed, 2 judged`;

const answeredNotHeld = `Commit the plan for todo?
  2 slices in 2 waves; longest chain: TD1,
    TD2; approve is not offered
  cut from docs/designs/todo/design.yaml and
    docs/requirements/todo.yaml: 13
    conditions
  wave 1: TD1, module todo; meets O1-C1,
    O1-C2, O1-C3, O1-C4, O1-C5, O1-C6, O1-C7
judged   TD1: A todo mode that adds a todo
judged     and lists the open ones
judged    by forge skills/plan, tier
judged      balanced
  wave 2: TD2, module todo; meets O2-C1,
    O2-C2, O2-C3, O2-C4, O2-C5, O2-C6
judged   TD2: The todo mode marks a todo
judged     done and removes one
judged    by forge skills/plan, tier
judged      balanced
  TD2 after TD1: It adds two actions to the
    mode TD1 makes.
  one after another because: Both slices
    write the one mode's folder, and the
    second adds to what the first makes.
  every condition met: yes
  fixed files made first: yes; 8 interface
    files by the design, 2 test files by
    their slices
  checked by script, as forge.waves checks a
    plan: no problem
  the first challenge answered P-34 not held
    and gave 1 finding; the planner answered
    once
  the planner changed TD2's meets and
    interface
  the second challenge's answers decide the
    card
  practices held by the script's checks:
    P-33, P-34 and P-35
  practices answered by the challenger: 3; 2
    held, 1 not held, 0 do not apply
judged   P-34, not held: TD2 writes the
judged     folder TD1 makes.
judged    by forge skills/challenge-plan,
judged      tier deep
  findings left after the planner's answer:
    1
judged   finding: TD2's item 3 is judgement
judged     only; its sentences could be a
judged     count.
judged    by forge skills/challenge-plan,
judged      tier deep
  approve commits it into integration as
    docs/plans/NNNN-todo.yaml, NNNN the next
    free number
Unmarked lines were worked out by script.
You can:
  stop  Stop; nothing is committed
Not available:
  approve  Commit the plan
           why: The challenger answered P-34
           not held, and a practice held by
           a plan must be held. The planner
           has answered the challenge once,
           which is the most a plan run
           asks.
checked: 0 ran, 16 computed, 4 judged`;

function withMeets(planned: Json, meets: readonly string[]): Json {
  return { ...fieldsOf(planned), meets: [...meets] };
}

describe("the plan card", () => {
  test("the todo plan cut from the todo design, every practice held and no finding, line by line", async () => {
    assert.equal(printedPlan(await todoInput(todoPlan)), todoCard);
  });

  test("after a second pass that left a practice not held and a finding, the card says what the first challenge found and that the planner answered once, its lines cite the second challenge, and approve is withheld, line by line", async () => {
    const input = {
      ...(await todoInput(todoPlan)),
      practices: p34NotHeld,
      findings: ["TD2's item 3 is judgement only; its sentences could be a count."],
      challenger: "challenge-2",
      answer: { kind: "answered", changes: ["TD2's meets and interface"], notHeld: ["P-34"], findings: 1 },
    } as const;
    assert.equal(printedPlan(input), answeredNotHeld);
    assert.deepEqual(planCard(input).offered, { approve: false });
  });

  test("a condition no slice meets and a fixed file changed first are listed, each problem is a line, and approve is withheld", async () => {
    const early = {
      ...fieldsOf(tdOne),
      slice: {
        ...fieldsOf(fieldsOf(tdOne).slice ?? null),
        scope: ["components/modes/todo/**", "components/modes/todo/tests/done-remove.test.ts"],
      },
    };
    const short = withMeets(tdTwo, ["O2-C1", "O2-C2", "O2-C3", "O2-C5", "O2-C6"]);
    const input = await todoInput({ ...fieldsOf(todoPlan), slices: [early, short] });
    const card = printedPlan(input).split("\n");
    const from = card.indexOf("  conditions no slice meets: O2-C4");
    assert.deepEqual(card.slice(from, from + 6), [
      "  conditions no slice meets: O2-C4",
      "  fixed files not made first:",
      "    components/modes/todo/tests/",
      "    done-remove.test.ts",
      "  checked by script, as forge.waves checks a",
      "    plan: 2 problems, 0 warnings",
    ]);
    assert.equal(card[from + 6], "  problem: No slice meets the condition");
    assert.equal(planCard(input).card.withheld.approve, "The plan check found 2 problems.");
  });

  test("a planner's answer that changed nothing says so", async () => {
    const answer = { kind: "answered", changes: [], notHeld: [], findings: 1 } as const;
    const lines = planCard({ ...(await todoInput(todoPlan)), answer }).card.lines.map((line) => line.words);
    assert.ok(lines.includes("the planner changed nothing"), lines.join("\n"));
  });

  test("every row of the card is at most 44 columns in the kernel's print", async () => {
    const long = { ...fieldsOf(tdOne), title: "A".repeat(300) };
    const rows = printedPlan(await todoInput({ ...fieldsOf(todoPlan), slices: [long, tdTwo] })).split("\n");
    assert.deepEqual(
      rows.filter((row) => Array.from(row).length > 44),
      [],
    );
    assert.ok(
      rows.some((row) => row.startsWith("judged") && row.endsWith("A...")),
      rows.join("\n"),
    );
  });
});

describe("what the planner changed", () => {
  test("a slice added, one removed, and the parts of one changed, with the plan's own parts", () => {
    const changedTwo = withMeets(tdTwo, ["O2-C1"]);
    const third = { ...fieldsOf(tdOne), slice: { ...fieldsOf(fieldsOf(tdOne).slice ?? null), name: "TD3" } };
    const first = { ...fieldsOf(todoPlan), slices: [tdOne, tdTwo] };
    const second = { ...fieldsOf(todoPlan), title: "Another title", slices: [changedTwo, third] };
    assert.deepEqual(planChanges(first, second), ["the plan's title", "TD2's meets", "TD3 added", "TD1 removed"]);
  });

  test("the same plan has no change", () => {
    assert.deepEqual(planChanges(todoPlan, todoPlan), []);
  });
});
