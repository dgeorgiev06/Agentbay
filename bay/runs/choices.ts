import type { Json } from "../contracts.ts";
import type { Choice as WorkflowChoice } from "../generated/workflow.ts";
import { fieldOf, isRecord, textField } from "../json.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";

export const choiceStatuses = ["offered", "withheld"] as const;

export type ChoiceStatus = {
  readonly name: string;
  readonly status: (typeof choiceStatuses)[number];
  readonly does: string;
};

export type Choice =
  | { readonly name: string; readonly status: "offered"; readonly does: string }
  | { readonly name: string; readonly status: "withheld"; readonly does: string; readonly reason: string };

export type ApprovalAnswer =
  { readonly decision: "approve" | "reject" } | { readonly decision: "choice"; readonly choice: string };

type Rules = {
  readonly stepId: string;
  readonly choices: Readonly<Record<string, WorkflowChoice>>;
  readonly resolve: (rule: string) => Outcome<Json>;
};

type Asked = {
  readonly choice: string;
  readonly shown: Json;
};

const reasonsField = "withheld";

function joined(names: readonly string[], last: "and" | "or"): string {
  if (names.length < 2) {
    return names[0] ?? "none";
  }
  return `${names.slice(0, -1).join(", ")} ${last} ${names.at(-1) ?? ""}`;
}

function described(value: Json): string {
  if (Array.isArray(value)) {
    return `a list of ${String(value.length)} elements`;
  }
  return isRecord(value) ? "a mapping" : JSON.stringify(value);
}

function statusOf(rules: Rules, name: string, choice: WorkflowChoice): ChoiceStatus | string {
  const { when: rule, does } = choice;
  if (rule === undefined) {
    return { name, status: "offered", does };
  }
  const value = rules.resolve(rule);
  const cannot = `Step ${rules.stepId} cannot offer the choice ${name}`;
  if (!value.ok) {
    return `${cannot}: ${problemText(value.problems)}`;
  }
  if (typeof value.value !== "boolean") {
    return `${cannot}: its rule ${rule} is ${described(value.value)}, not true or false.`;
  }
  return { name, status: value.value ? "offered" : "withheld", does };
}

export function evaluatedChoices(rules: Rules): Outcome<readonly ChoiceStatus[]> {
  const evaluated = Object.entries(rules.choices).map(([name, choice]) => statusOf(rules, name, choice));
  const problems = evaluated.filter((status) => typeof status === "string");
  if (problems.length > 0) {
    return failedWith(problems.map((message) => unplacedProblem(message)));
  }
  return succeededWith(evaluated.filter((status) => typeof status !== "string"));
}

function reasonsOf(content: Json): Json | undefined {
  return isRecord(content) ? fieldOf(content, reasonsField) : undefined;
}

function missingReasons(stepId: string, statuses: readonly ChoiceStatus[], reasons: Json | undefined): string[] {
  return statuses.flatMap((choice) => {
    const reason = reasons === undefined ? undefined : textField(reasons, choice.name);
    if (choice.status === "offered" || (reason !== undefined && reason.trim() !== "")) {
      return [];
    }
    return [
      `Step ${stepId} withholds the choice ${choice.name}, since its rule is false, ` +
        `but what it shows gives no reason under ${reasonsField}.${choice.name}.`,
    ];
  });
}

function strayReasons(stepId: string, statuses: readonly ChoiceStatus[], reasons: Json | undefined): string[] {
  if (reasons === undefined) {
    return [];
  }
  if (!isRecord(reasons)) {
    return [`Step ${stepId} shows ${reasonsField} as ${described(reasons)}, not a mapping of choices to reasons.`];
  }
  return Object.keys(reasons).flatMap((name) => {
    const choice = statuses.find((status) => status.name === name);
    const under = `Step ${stepId} shows a reason under ${reasonsField}.${name}`;
    if (choice === undefined) {
      return [`${under}, but it has no choice ${name}.`];
    }
    if (choice.status === "offered") {
      return [
        `${under}, but its choice ${name} is offered; what a step shows gives a reason only for a choice it withholds.`,
      ];
    }
    return [];
  });
}

export function reasonProblems(stepId: string, statuses: readonly ChoiceStatus[], content: Json): readonly string[] {
  const reasons = reasonsOf(content);
  return [...missingReasons(stepId, statuses, reasons), ...strayReasons(stepId, statuses, reasons)];
}

export function shownChoices(statuses: readonly ChoiceStatus[], content: Json): readonly Choice[] {
  const reasons = reasonsOf(content);
  return statuses.map(({ name, status, does }) => {
    switch (status) {
      case "offered":
        return { name, status, does };
      case "withheld":
        return { name, status, does, reason: (reasons === undefined ? undefined : textField(reasons, name)) ?? "" };
    }
  });
}

function choiceRefusal(stepKey: string, statuses: readonly ChoiceStatus[], asked: Asked): string | undefined {
  const choice = shownChoices(statuses, asked.shown).find((each) => each.name === asked.choice);
  if (choice === undefined) {
    const offered = statuses.filter((each) => each.status === "offered").map((each) => each.name);
    return `Step ${stepKey} has no choice ${asked.choice}; the choices offered are ${joined(offered, "and")}.`;
  }
  switch (choice.status) {
    case "offered":
      return undefined;
    case "withheld":
      return `The choice ${choice.name} of step ${stepKey} is withheld: ${choice.reason}`;
  }
}

export function decisionRefusal(
  stepKey: string,
  statuses: readonly ChoiceStatus[] | undefined,
  given: { readonly answer: ApprovalAnswer; readonly shown: Json },
): string | undefined {
  const { answer, shown } = given;
  switch (answer.decision) {
    case "approve":
    case "reject": {
      const names = statuses?.map((choice) => choice.name);
      return names === undefined
        ? undefined
        : `Step ${stepKey} offers choices, so a decision names one of them: ${joined(names, "or")}.`;
    }
    case "choice":
      return statuses === undefined
        ? `Step ${stepKey} offers no choices, so a decision approves or rejects what it shows.`
        : choiceRefusal(stepKey, statuses, { choice: answer.choice, shown });
  }
}
