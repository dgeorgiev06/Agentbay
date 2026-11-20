import type { Chosen } from "./challenge-answer.ts";
import { computed, counted, joined, judged, type Card, type CardLine } from "./card-lines.ts";
import { actionsOf, type Action, type Design, type Interface, type Module } from "./design-form.ts";
import { heldByRules, ruleCount } from "./design-rules.ts";
import type { DesignPath } from "./path-card.ts";
import { notHeldReason, practiceLines, type PracticeAnswer } from "./practice-answers.ts";
import { conditionsOf, type Requirements } from "./requirements-form.ts";

export type DesignCardInput = {
  readonly file: string;
  readonly requirements: Requirements;
  readonly path: DesignPath;
  readonly chosen: Chosen;
  readonly because: string;
  readonly design: Design;
  readonly problems: readonly string[];
  readonly refusedSchemas: number;
  readonly practices: readonly PracticeAnswer[];
  readonly differences: readonly string[];
};

export type DesignCard = {
  readonly card: Card & { readonly withheld: { readonly approve?: string } };
  readonly offered: { readonly approve: boolean };
};

const designers = "designs";

const challenger = "challenge";

const differencesShown = 8;

const answers: Readonly<Record<Chosen, string>> = {
  first: "the first design of two written apart",
  second: "the second design of two written apart",
  merged: "a design the challenger merged from two written apart",
};

function answerWords(input: DesignCardInput): string {
  return input.path === "light" ? "the one design, on the light path" : answers[input.chosen];
}

function withheldReason(input: DesignCardInput): string | undefined {
  const reasons = [
    ...(input.problems.length === 0 ? [] : [`The design check found ${counted(input.problems.length, "problem")}.`]),
    ...notHeldReason(input.practices, "design"),
  ];
  return reasons.length === 0 ? undefined : reasons.join(" ");
}

function ownsWords(module: Module): string {
  const tables = module.tables.map((table) => `the table ${table}`);
  const files = module.files.map((file) => `the file ${file}`);
  const owned = [...tables, ...files];
  return owned.length === 0 ? "owns nothing" : `owns ${joined(owned)}`;
}

function moduleLines(module: Module, by: string): readonly CardLine[] {
  return [
    computed("draw", `module ${module.name}: implements ${joined(module.implements)}; ${ownsWords(module)}`),
    judged(by, `${module.name} hides: ${module.hides}`),
  ];
}

function servesWords(action: Action): string {
  if (action.serves.length === 0) {
    return `serves no condition: ${action.because ?? ""}`;
  }
  return `serves ${action.serves.join(", ")}`;
}

function interfaceLines(each: Interface): readonly CardLine[] {
  const heading = `interface ${each.name}: ${counted(each.actions.length, "action")}, ${counted(
    each.actions.length * 2,
    "schema file",
  )}`;
  const actions = each.actions.map((action) =>
    computed("draw", `${action.name}: ${servesWords(action)}; ${counted(action.examples.length, "example")}`),
  );
  return [computed("draw", heading), ...actions];
}

function coverageWords(input: DesignCardInput): string {
  const served = actionsOf(input.design).flatMap((action) => action.serves);
  const missed = conditionsOf(input.requirements).filter((condition) => !served.includes(condition));
  return missed.length === 0
    ? "coverage: every condition is served by an action: yes"
    : `coverage: no action serves ${missed.join(", ")}`;
}

function examplesWords(input: DesignCardInput): string {
  const examples = actionsOf(input.design).flatMap((action) => action.examples);
  const refusals = examples.filter((example) => "refusal" in example.told).length;
  const notChecked = [
    ...(refusals === 0 ? [] : [`the input of the ${counted(refusals, "refusal")}`]),
    ...(input.refusedSchemas === 0
      ? []
      : [`against the ${counted(input.refusedSchemas, "schema")} the kernel refused`]),
  ];
  const counts = `examples: ${String(examples.length)}`;
  if (notChecked.length === 0) {
    return `${counts}, each checked against its action's schemas`;
  }
  return `${counts}, checked against their actions' schemas, but not ${joined(notChecked)}`;
}

function checkLines(input: DesignCardInput): readonly CardLine[] {
  const found = input.problems.length === 0 ? "no problem" : counted(input.problems.length, "problem");
  return [
    computed("draw", coverageWords(input)),
    computed("draw", `checked by script: ${String(ruleCount)} rules of the design, ${found}`),
    ...input.problems.map((problem) => computed("draw", `problem: ${problem}`)),
    computed("draw", examplesWords(input)),
  ];
}

function differenceLines(input: DesignCardInput): readonly CardLine[] {
  if (input.path === "light") {
    return [computed("draw", "one design was written, so none was compared")];
  }
  const shown = input.differences.slice(0, differencesShown);
  const more = input.differences.length - shown.length;
  return [
    computed("draw", `where the two designs differed: ${String(input.differences.length)}`),
    ...shown.map((difference) => computed("draw", difference)),
    ...(more > 0 ? [computed("draw", `and ${String(more)} more`)] : []),
    judged(challenger, `chosen because: ${input.because}`),
  ];
}

export function designCard(input: DesignCardInput): DesignCard {
  const reason = withheldReason(input);
  const offered = reason === undefined ? "approve is offered" : "approve is not offered";
  const by = input.chosen === "merged" ? challenger : designers;
  const conditions = counted(conditionsOf(input.requirements).length, "condition");
  const lines = [
    computed("draw", `${answerWords(input)}; ${offered}`),
    computed(
      "draw",
      `requirements: ${input.file}: ${counted(input.requirements.outcomes.length, "outcome")}, ${conditions}`,
    ),
    ...input.design.modules.flatMap((module) => moduleLines(module, by)),
    ...input.design.interfaces.flatMap(interfaceLines),
    ...checkLines(input),
    ...practiceLines({ answers: input.practices, heldByRules, challenger }),
    ...differenceLines(input),
  ];
  const title = `Commit the design of ${input.requirements.job}?`;
  return {
    card: { title, lines, withheld: reason === undefined ? {} : { approve: reason } },
    offered: { approve: reason === undefined },
  };
}
