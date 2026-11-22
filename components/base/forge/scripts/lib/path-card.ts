import { computed, counted, facts, shortFacts, type Fact, type Screen } from "./card-lines.ts";
import { conditionsOf, type Outcome, type Requirements } from "./requirements-form.ts";

export type DesignPath = "light" | "full";

export type Stance = "first" | "second";

const designTier = "deep";

const checkRounds = 3;

const stances: Readonly<Record<Stance, string>> = {
  first: "Use the fewest modules and actions that serve every condition.",
  second: "Split the modules by what each hides, starting from who owns what is stored.",
};

export function stanceOf(which: Stance): string {
  return stances[which];
}

export function pathOf(choice: string): DesignPath | undefined {
  if (choice === "light" || choice === "full") {
    return choice;
  }
  return undefined;
}

export const stoppedOnPath = "The owner chose stop on the first card, so no design is written.";

type Calls = { readonly calls: number; readonly answered: number; readonly most: number };

function callCounts(designers: number): Calls {
  const calls = designers + 1;
  const answered = calls + 2;
  return { calls, answered, most: answered * checkRounds };
}

function usualWords(designers: number): string {
  const { answered, most } = callCounts(designers);
  return `usually ${String(answered)}, at most ${String(most)}`;
}

function callWords(designers: number): string {
  const { calls, answered, most } = callCounts(designers);
  return (
    `${String(calls)} model calls; ${String(answered)} when the designer answers the review step once; ` +
    `up to ${String(most)} when checks send answers back to be written again.`
  );
}

function outcomeFacts(outcome: Outcome): readonly Fact[] {
  const lines = [
    computed("start", `The outcome: ${outcome.says}`),
    computed("start", `${counted(outcome.conditions.length, "condition")}.`),
  ];
  return facts("what", lines, `outcome ${outcome.id}`);
}

function shortWhat(requirements: Requirements): readonly Fact[] {
  const { outcomes } = requirements;
  const counts = `${counted(outcomes.length, "outcome")}, ${counted(conditionsOf(requirements).length, "condition")}.`;
  return shortFacts("what", [
    computed("start", `Your ${requirements.job} requirements, version ${String(requirements.version)}.`),
    computed("start", counts),
    computed("start", `Model calls: light ${usualWords(1)}; full ${usualWords(2)}.`),
  ]);
}

function requirementsFacts(file: string, requirements: Requirements): readonly Fact[] {
  const lines = [
    computed("start", `The file: ${file}.`),
    computed("start", `Version ${String(requirements.version)}, signed by ${requirements.signedBy}.`),
    computed("start", `${counted(requirements.leftOut, "thing")} left out on purpose.`),
  ];
  return facts("what", lines, "your requirements");
}

function pathFacts(): readonly Fact[] {
  const light = [
    computed("start", "One designer writes the design; then a review step says which practices it holds."),
    computed("start", callWords(1)),
  ];
  const full = [
    computed(
      "start",
      "Two designers write apart; then a review step compares the two and chooses one, or merges them.",
    ),
    computed("start", callWords(2)),
  ];
  const both = [
    computed("start", `Every model call is at the ${designTier} tier, the strongest of the three model tiers.`),
    computed("start", "Each action's request and response are written as schema files."),
  ];
  return [
    ...facts("what", light, "the light path"),
    ...facts("what", full, "the full path"),
    ...facts("what", both, "either path"),
  ];
}

export function pathCard(file: string, requirements: Requirements): Screen {
  return {
    title: `How should the ${requirements.job} design be written?`,
    lines: [
      ...shortWhat(requirements),
      ...requirementsFacts(file, requirements),
      ...requirements.outcomes.flatMap(outcomeFacts),
      ...pathFacts(),
    ],
  };
}
