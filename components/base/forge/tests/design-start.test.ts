import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pathCard } from "../scripts/lib/path-card.ts";
import { factOf, type Fact } from "./kit-copy.ts";
import { requirementsFile, todoRequirements } from "./todo-plan.ts";

type Said = readonly [section: string, short: boolean, about: string, words: string];

function startFact([section, short, about, words]: Said): Fact {
  return { section, short, about, mark: "computed", words, step: "start" };
}

const todoStartFacts: readonly Fact[] = (
  [
    ["what", true, "", "Your todo requirements, version 1."],
    ["what", true, "", "2 outcomes, 13 conditions."],
    ["what", true, "", "Model calls: light 2 to 12, full 3 to 15."],
    ["what", false, "your requirements", "The file: docs/requirements/todo.yaml."],
    ["what", false, "your requirements", "Version 1, signed by owner."],
    ["what", false, "your requirements", "5 things left out on purpose."],
    ["what", false, "outcome O1", "The outcome: A person adds a todo and sees it among the open ones."],
    ["what", false, "outcome O1", "7 conditions."],
    ["what", false, "outcome O2", "The outcome: A person marks a todo done, or removes it."],
    ["what", false, "outcome O2", "6 conditions."],
    [
      "what",
      false,
      "the light path",
      "One designer writes the design; then a review step says which practices it holds.",
    ],
    [
      "what",
      false,
      "the light path",
      "2 model calls; 4 when the designer answers the review step once; up to 12 when checks send answers back " +
        "to be written again.",
    ],
    [
      "what",
      false,
      "the full path",
      "Two designers write apart; then a review step compares the two and chooses one, or merges them.",
    ],
    [
      "what",
      false,
      "the full path",
      "3 model calls; 5 when the designer answers the review step once; up to 15 when checks send answers back " +
        "to be written again.",
    ],
    ["what", false, "either path", "Every model call is at the deep tier, the strongest of the three model tiers."],
    ["what", false, "either path", "Each action's request and response are written as schema files."],
  ] satisfies readonly Said[]
).map(startFact);

describe("the design run's start screen, for the todo requirements", () => {
  test("it hands these facts, in this order, every one worked out by the start step's script", async () => {
    const screen = pathCard(requirementsFile, await todoRequirements());
    assert.deepEqual(
      screen.lines.map((line) => factOf({ ...line })),
      todoStartFacts,
    );
    assert.equal(screen.title, "How should the todo design be written?");
  });

  test("the counts follow the requirements it is handed", async () => {
    const todo = await todoRequirements();
    const [first] = todo.outcomes;
    assert.ok(first !== undefined);
    const third = { ...first, id: "O3", conditions: first.conditions.slice(0, 1) };
    const more = { ...todo, version: 4, leftOut: 1, outcomes: [...todo.outcomes, third] };
    const words = pathCard(requirementsFile, more).lines.map((line) => line.words);
    assert.ok(words.includes("Your todo requirements, version 4."), words.join("\n"));
    assert.ok(words.includes("3 outcomes, 14 conditions."), words.join("\n"));
    assert.ok(words.includes("1 thing left out on purpose."), words.join("\n"));
    assert.ok(words.includes("1 condition."), words.join("\n"));
  });
});
