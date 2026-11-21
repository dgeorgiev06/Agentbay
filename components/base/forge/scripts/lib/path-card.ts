import { computed, counted, type Card } from "./card-lines.ts";
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

function costWords(designers: number): string {
  const calls = designers + 1;
  const answered = calls + 2;
  return (
    `${String(calls)} calls at tier ${designTier}, ${String(answered)} when the designer answers the challenger ` +
    `once, up to ${String(answered * checkRounds)} when checks send them back`
  );
}

function outcomeWords(outcome: Outcome): string {
  return `${outcome.id}, ${counted(outcome.conditions.length, "condition")}: ${outcome.says}`;
}

export function pathCard(file: string, requirements: Requirements): Card {
  const { outcomes } = requirements;
  const words = [
    `requirements: ${file}, version ${String(requirements.version)}, signed by ${requirements.signedBy}`,
    ...outcomes.map(outcomeWords),
    `in all: ${counted(outcomes.length, "outcome")}, ${counted(conditionsOf(requirements).length, "condition")}; ` +
      `${String(requirements.leftOut)} left out on purpose`,
    `light: one designer, then a challenger who answers the practices held by design: ${costWords(1)}`,
    `full: two designers who write apart, then a challenger who compares the two and chooses: ${costWords(2)}`,
    "either path writes each action's request and response as schema files",
  ];
  return {
    title: `Which path for the design of ${requirements.job}?`,
    lines: words.map((said) => computed("start", said)),
  };
}
