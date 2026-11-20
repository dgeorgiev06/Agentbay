import { computed, counted, type Card } from "./card-lines.ts";
import { conditionsOf, type Outcome, type Requirements } from "./requirements-form.ts";

export type DesignPath = "light" | "full";

export const designTier = "deep";

const stances: Readonly<Record<"first" | "second", string>> = {
  first: "Use the fewest modules and actions that serve every condition.",
  second: "Split the modules by what each hides, starting from who owns what is stored.",
};

export function stanceOf(which: "first" | "second"): string {
  return stances[which];
}

export function pathOf(choice: string): DesignPath | undefined {
  if (choice === "light" || choice === "full") {
    return choice;
  }
  return undefined;
}

export const stoppedOnPath = "The owner chose stop on the first card, so no design is written.";

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
    `light: one designer, then a challenger who answers the practices held by design: 2 calls at tier ` +
      `${designTier}, up to 6 when checks send them back`,
    `full: two designers who write apart, then a challenger who compares the two and chooses: 3 calls at ` +
      `tier ${designTier}, up to 9 when checks send them back`,
    "either path writes each action's request and response as schema files",
  ];
  return {
    title: `Which path for the design of ${requirements.job}?`,
    lines: words.map((said) => computed("start", said)),
  };
}
