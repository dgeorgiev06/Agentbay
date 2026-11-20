import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { numberField } from "../bay/json.ts";
import type { Run } from "../bay/runs/runs.ts";
import { checkedValue } from "../bay/value-check.ts";
import {
  finished,
  fixtureRefusal,
  fixtureSystem,
  notesFlow,
  openedRuns,
  runOf,
  withFlow,
  type Changes,
  type Script,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

type Tally = { running: number; most: number; ran: number };

function tallied(tally: Tally): Script {
  return async (request) => {
    tally.ran += 1;
    tally.running += 1;
    tally.most = Math.max(tally.most, tally.running);
    await new Promise((resolve) => setTimeout(resolve, 15));
    tally.running -= 1;
    return finished({ n: numberField(request.input, "n") ?? -1 });
  };
}

function eachLog(sideBySide: number | string, before: Workflow["steps"] = []): Workflow["steps"] {
  return [
    { id: "given", action: "log", input: { items: "$trigger", cap: 4 } },
    ...before,
    {
      id: "each",
      foreach: "$steps.given.output.items",
      sideBySide,
      steps: [{ id: "do", action: "slow", input: { n: "$item" } }],
    },
  ];
}

const slow = {
  description: "When a test takes a while over an item.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read" as const],
  run: [{ script: "scripts/slow.ts" }],
};

async function ranWith(steps: Workflow["steps"], cap: Json): Promise<{ readonly run: Run; readonly tally: Tally }> {
  const tally = { running: 0, most: 0, ran: 0 };
  const config = { settings: { notes: { greeting: "hello", cap } } };
  const changes = { ...withFlow(steps), notesActions: { slow }, config };
  const { runs, close } = await openedRuns({ scripts: { "notes:scripts/slow.ts": tallied(tally) }, changes });
  const run = runOf(await runs.start(flow, [0, 1, 2, 3, 4, 5]));
  close();
  return { run, tally };
}

function undoneWith(run: Run): string {
  assert.ok(run.state.status === "undone", JSON.stringify(run.state));
  return run.state.reason;
}

test("sideBySide from a setting caps the items that run at once at the setting's value", async () => {
  const { run, tally } = await ranWith(eachLog("$settings.cap"), 3);
  assert.deepEqual(run.state, {
    status: "done",
    output: [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
  });
  assert.equal(tally.most, 3);
});

test("sideBySide may come from an earlier step's output", async () => {
  const sized = [{ id: "size", action: "log", input: { cap: 2 } }];
  const fromStep = await ranWith(eachLog("$steps.size.output.cap", sized), 3);
  assert.equal(fromStep.run.state.status, "done");
  assert.equal(fromStep.tally.most, 2);
  const fromFirst = await ranWith(eachLog("$steps.given.output.cap"), 3);
  assert.equal(fromFirst.run.state.status, "done");
  assert.equal(fromFirst.tally.most, 4);
});

test("a value that is not a whole number from 2 to 8 refuses the foreach, naming the step and the value", async () => {
  const cases: readonly (readonly [Json, string])[] = [
    [9, "the value 9"],
    [1, "the value 1"],
    [2.5, "the value 2.5"],
    ["3", 'the value "3"'],
    [[3], "a list"],
    [null, "the value null"],
  ];
  for (const [cap, said] of cases) {
    const { run, tally } = await ranWith(eachLog("$settings.cap"), cap);
    assert.equal(
      undoneWith(run),
      `Step each cannot run its items side by side: sideBySide is $settings.cap, which is ${said}; ` +
        "it must be a whole number from 2 to 8.",
    );
    assert.equal(tally.ran, 0);
    assert.deepEqual(
      run.steps.filter((step) => !step.key.includes("/")).map((step) => [step.key, step.status]),
      [
        ["given", "done"],
        ["each", "failed"],
      ],
    );
  }
});

test("a reference that resolves to nothing refuses the foreach with the reason it resolves to nothing", async () => {
  const { run, tally } = await ranWith(eachLog("$settings.most"), 3);
  assert.equal(
    undoneWith(run),
    "Step each cannot run its items side by side: $settings.most resolves to nothing: the mode's settings " +
      "have no most (available: greeting, cap).",
  );
  assert.equal(tally.ran, 0);
});

test("a setting changed while the run waits is read again when the foreach resumes, started items go on, and a bad one refuses it", async () => {
  const steps: Workflow["steps"] = [
    { id: "given", action: "log", input: { items: "$trigger" } },
    {
      id: "each",
      foreach: "$steps.given.output.items",
      sideBySide: "$settings.cap",
      steps: [{ id: "write", action: "draft", input: { topic: "$item" } }],
    },
  ];
  const changesWith = (cap: Json): Changes => ({
    ...withFlow(steps),
    config: { settings: { notes: { greeting: "hello", cap } } },
  });
  const opened = await openedRuns({ changes: changesWith(2) });
  const started = runOf(await opened.runs.start(flow, ["tea", "coffee", "milk", "juice"]));
  const waitingKeys = (run: Run): readonly string[] => {
    assert.ok(run.state.status === "waiting", JSON.stringify(run.state));
    return [run.state.waiting, ...(run.state.alsoWaiting ?? [])].map((waiting) => waiting.stepKey);
  };
  assert.deepEqual(waitingKeys(started), ["each[0].write/0#1", "each[1].write/0#1"]);
  assert.ok(!started.steps.some((step) => step.key.startsWith("each[2]") || step.key.startsWith("each[3]")));
  opened.runs.close();
  const wider = await opened.reopen((await fixtureSystem(changesWith(4))).system);
  const resumed = runOf(await wider.resume(started.id));
  assert.deepEqual(waitingKeys(resumed), [
    "each[0].write/0#1",
    "each[1].write/0#1",
    "each[2].write/0#1",
    "each[3].write/0#1",
  ]);
  wider.close();
  const narrower = await opened.reopen((await fixtureSystem(changesWith(2))).system);
  assert.deepEqual(waitingKeys(runOf(await narrower.resume(started.id))), waitingKeys(resumed));
  narrower.close();
  const broken = await opened.reopen((await fixtureSystem(changesWith(9))).system);
  const refused = runOf(await broken.resume(started.id));
  opened.close();
  assert.equal(
    undoneWith(refused),
    "Step each cannot run its items side by side: sideBySide is $settings.cap, which is the value 9; " +
      "it must be a whole number from 2 to 8.",
  );
});

test("bay check refuses a sideBySide reference it can see is wrong before any run", async () => {
  const problems = async (sideBySide: string, before: Workflow["steps"] = []): Promise<readonly string[]> =>
    fixtureRefusal({ ...withFlow(eachLog(sideBySide, before)), notesActions: { slow } });
  const reference = "Workflow workflows/flow.yaml of mode notes has a reference problem: ";
  assert.deepEqual(await problems("$steps.each.output"), [
    `${reference}$steps.each.output names the step each, which is not defined before this step in its scope ` +
      "(earlier steps: given).",
  ]);
  assert.deepEqual(await problems("$item"), [`${reference}$item is used outside a foreach.`]);
  assert.deepEqual(await problems("$cap"), [
    `${reference}$cap is not a reference: write $trigger, $item, $settings.<key> or $steps.<id>.output with an ` +
      "optional dotted path such as .items.0. Every value that starts with $ is read as a reference.",
  ]);
  assert.deepEqual(await problems("four"), [
    "steps.1.sideBySide is not in the expected form. Expected: A reference to a whole number from 2 to 8: " +
      "$settings.<key>, $steps.<id>.output with an optional path, $trigger, or $item of an enclosing foreach.",
  ]);
});

test("a value outside every branch of a choice of plain types is worded by the types it may take", () => {
  const schema = {
    oneOf: [
      { type: "integer", maximum: 8 },
      { type: "string", pattern: "^\\$", description: "A reference." },
    ],
  };
  const check = (value: Json): readonly string[] => {
    const checked = checkedValue("sideBySide", { state: "valid", schema, parts: {} }, value);
    return checked.passed ? [] : checked.problems.map((problem) => problem.message);
  };
  assert.deepEqual(check(9), ["This file must be at most 8, but it is 9."]);
  assert.deepEqual(check("four"), ["This file is not in the expected form. Expected: A reference."]);
  assert.deepEqual(check(true), ["This file must be a whole number or text, but it is true."]);
  assert.deepEqual(check(2.5), ["This file must be a whole number, but it is 2.5."]);
  assert.deepEqual(check("$settings.cap"), []);
});
