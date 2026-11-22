import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readYaml } from "../../../../bay/sdk.ts";
import { designSummaryOf, type DesignSummary } from "../scripts/lib/design-summary.ts";
import { gateOf } from "../scripts/lib/gate.ts";
import { planOf } from "../scripts/lib/plan-form.ts";
import type { PlannedSlice } from "../scripts/lib/plan.ts";
import { waveStartCard, type WaveStart } from "../scripts/lib/wave-start-card.ts";
import { factOf, type Fact } from "./kit-copy.ts";
import { designFile, todoDesignFiles, todoPlan } from "./todo-plan.ts";
import { plannedSlice } from "./wave-run.ts";

type Said = readonly [section: string, short: boolean, about: string, words: string];

function waveFact([section, short, about, words]: Said): Fact {
  return { section, short, about, mark: "computed", words, step: "wave" };
}

const base = "7216af5c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60";

const left = "e92c6d1a2b3c4d5e6f708192a3b4c5d6e7f80912";

function todoDesign(): DesignSummary {
  const [designed] = todoDesignFiles();
  const read = readYaml(designed?.text ?? "");
  assert.ok(read.ok);
  return designSummaryOf(designFile, read.value);
}

function todoStart(slices: readonly PlannedSlice[], changes: Partial<WaveStart> = {}): WaveStart {
  return { ...withoutDesign(slices), design: todoDesign(), ...changes };
}

function withoutDesign(slices: readonly PlannedSlice[], changes: Partial<WaveStart> = {}): WaveStart {
  return {
    plan: "docs/plans/0025-todo.yaml",
    wave: 1,
    waves: 1,
    base,
    into: "feat/0022-agentbay5",
    slices,
    sideBySide: 2,
    leftovers: [{ branch: "forge/TD1", commit: left }],
    gate: { gate: gateOf(slices), alsoRun: ["tests/kit-check.test.ts"] },
    ...changes,
  };
}

const schemas = "docs/designs/todo/schemas/todo";

const todoStartFacts: readonly Fact[] = (
  [
    [
      "problems",
      false,
      "",
      "1 branch is left from an earlier build of this wave. Building over drops them; each branch and its full " +
        "commit are in the details, so their work can be found again.",
    ],
    ["what", true, "", "TD1 builds the mode todo."],
    ["what", true, "", "It meets 7 of your conditions."],
    ["what", true, "", "At most 27 model calls."],
    ["what", false, "the plan", "The plan you approved describes it: docs/plans/0025-todo.yaml, slice TD1."],
    ["what", false, "the plan", "This is wave 1 of 1 of that plan."],
    [
      "what",
      false,
      "the plan",
      `The plan was read at commit ${base}, the head of feat/0022-agentbay5; each slice is cut from that commit.`,
    ],
    ["what", false, "slice TD1", "TD1 builds the mode todo; it writes only inside components/modes/todo."],
    ["what", false, "slice TD1", "Its actions, from the design docs/designs/todo/design.yaml: add and list."],
    ["what", false, "slice TD1", "In the design, it reaches the module todo."],
    ["what", false, "slice TD1", "It meets 7 of your conditions, by id."],
    ["what", false, "slice TD1", "O1-C1, O1-C2, O1-C3, O1-C4, O1-C5, O1-C6, O1-C7."],
    ["what", false, "slice TD1", "It names 4 interface files."],
    ["what", false, "slice TD1", `The file ${schemas}/add-request.json.`],
    ["what", false, "slice TD1", `The file ${schemas}/add-response.json.`],
    ["what", false, "slice TD1", `The file ${schemas}/list-request.json.`],
    ["what", false, "slice TD1", `The file ${schemas}/list-response.json.`],
    ["what", false, "side by side", "At most 2 builders at once, by the setting sideBySide."],
    ["what", false, "model calls", "At most 27 model calls a slice, 27 for the wave."],
    [
      "what",
      false,
      "model calls",
      "A slice's calls: declare 3, write-tests 9, build-without-tests 3, review 9, plant 3.",
    ],
    ["what", false, "model calls", "A step whose answer a check may send back counts 3 calls."],
    ["what", false, "branches an earlier run left", `The branch forge/TD1, at commit ${left}.`],
    [
      "what",
      false,
      "branches an earlier run left",
      "Building over drops them; with these commits their work can be found again.",
    ],
    ["checks", true, "", "At the end: the todo mode's tests, the fast checks and bay check; not the other tests."],
    [
      "checks",
      false,
      "the gate",
      "Gate: the mode's own tests and the fast checks of the whole project, since TD1 writes only inside " +
        "components/modes/todo; the other tests are not run.",
    ],
    [
      "checks",
      false,
      "the gate",
      "The mode gate: every test file under components/modes/todo at the head, the toolchain's checks of the " +
        "whole project, bay check on the head, and tests/kit-check.test.ts, which the setting modeGateTests adds.",
    ],
    [
      "checks",
      false,
      "the gate",
      "Each slice's own proof leaves out the checks; they run once, on the slices combined.",
    ],
  ] satisfies readonly Said[]
).map(waveFact);

function factsOfStart(start: WaveStart): readonly Fact[] {
  return waveStartCard(start).lines.map((line) => factOf({ ...line }));
}

function wordsOf(start: WaveStart, about?: string): readonly string[] {
  const all = factsOfStart(start);
  return (about === undefined ? all : all.filter((fact) => fact.about === about)).map((fact) => fact.words);
}

const [tdOne] = planOf(todoPlan).slices;

describe("the wave's start screen, for the todo plan's first slice", () => {
  test("it hands these facts, in this order, every one worked out by the wave step's script", () => {
    assert.ok(tdOne !== undefined);
    assert.deepEqual(factsOfStart(todoStart([tdOne])), todoStartFacts);
    assert.equal(waveStartCard(todoStart([tdOne])).title, "Build the todo mode?");
  });

  test("no fact holds the planner's title or an item's words: a model wrote them", () => {
    assert.ok(tdOne !== undefined);
    const words = wordsOf(todoStart([tdOne])).join("\n");
    assert.ok(!words.includes(tdOne.title), words);
    assert.ok(!words.includes("fails without the mode's code"), words);
  });

  test("with no branch left there is no problem and no leftover fact", () => {
    assert.ok(tdOne !== undefined);
    const clean = factsOfStart(todoStart([tdOne], { leftovers: [] }));
    assert.deepEqual(
      clean.filter((fact) => fact.section === "problems"),
      [],
    );
    assert.ok(!clean.some((fact) => fact.about === "branches an earlier run left"));
  });

  test("the problem counts every branch left, and the details give each with its full commit", () => {
    assert.ok(tdOne !== undefined);
    const branches = ["forge/TD1", "forge/TD1-tests-1", "forge/TD1-tests-2", "forge/TD1-2", "forge/wave-1"];
    const leftovers = branches.map((branch) => ({ branch, commit: left }));
    const start = todoStart([tdOne], { leftovers });
    const [problem] = factsOfStart(start).filter((fact) => fact.section === "problems");
    assert.match(problem?.words ?? "", /^5 branches are left from an earlier build of this wave\./);
    assert.deepEqual(
      wordsOf(start, "branches an earlier run left").slice(0, -1),
      branches.map((branch) => `The branch ${branch}, at commit ${left}.`),
    );
  });
});

describe("the wave's start screen, for other waves", () => {
  const twoModes = planOf({ title: "A wave", slices: [plannedSlice("TD1"), plannedSlice("TD10")] }).slices;

  test("a wave of slices in two modes is titled by its plan file, says the whole test run, and counts the calls of both", () => {
    const start = withoutDesign(twoModes, { waves: 2, leftovers: [] });
    assert.equal(waveStartCard(start).title, "Build wave 1 of 2 of plan 0025-todo.yaml?");
    const short = factsOfStart(start).filter((fact) => fact.short);
    assert.deepEqual(
      short.map((fact) => fact.words),
      [
        "2 slices: TD1 and TD10.",
        "They meet none of your conditions.",
        "At most 54 model calls.",
        "At the end: the checks and every test of the project, on the slices combined.",
      ],
    );
    assert.ok(
      wordsOf(start, "the gate").includes(
        "Gate: the whole test run, since the slices write inside more than one mode's folder " +
          "(components/modes/td1 and components/modes/td10).",
      ),
    );
    assert.ok(
      wordsOf(start, "slice TD10").includes("TD10 builds the mode td10; it writes only inside components/modes/td10."),
    );
  });

  test("a later wave of one mode is titled by that wave, and a slice outside a mode's folder says its kind and scope", () => {
    assert.ok(tdOne !== undefined);
    assert.equal(waveStartCard(todoStart([tdOne], { wave: 2, waves: 2 })).title, "Build wave 2 of 2 of the todo mode?");
    const outside = { ...tdOne, name: "TB", kind: "capability" as const, scope: ["components/base/tb/**"] };
    assert.ok(
      wordsOf(todoStart([outside]), "slice TB").includes(
        "TB is a slice of kind capability; it writes in components/base/tb/**.",
      ),
    );
  });

  test("more slices than the setting says which start first and that the rest start as slices end", () => {
    const four = planOf({ title: "A wave", slices: ["A1", "A2", "A3", "A4"].map(plannedSlice) }).slices;
    const start = (slices: readonly PlannedSlice[]): WaveStart => todoStart(slices, { leftovers: [] });
    assert.ok(
      wordsOf(start(four), "side by side").includes(
        "First A1 and A2; then A3 and A4, each starting as soon as a slice ends.",
      ),
    );
    assert.ok(
      wordsOf(start(four.slice(0, 3)), "side by side").includes(
        "First A1 and A2; then A3, which starts as soon as a slice ends.",
      ),
    );
  });

  test("a design action whose name is not a plain name is left out", () => {
    assert.ok(tdOne !== undefined);
    const design = todoDesign();
    const renamed = design.actions.map((action) =>
      action.action === "todo.add" ? { ...action, action: "todo.Add everything" } : action,
    );
    const words = wordsOf(todoStart([tdOne], { design: { ...design, actions: renamed } }), "slice TD1");
    assert.ok(words.includes("Its actions, from the design docs/designs/todo/design.yaml: list."), words.join("\n"));
  });
});
