import type { Json, RunEvent } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import { fieldOf, isRecord, textField, textsField } from "../json.ts";
import type { ChoiceStatus } from "./choices.ts";

export type WorkflowPart = {
  readonly given: ReadonlyMap<string, Json>;
  readonly until: string | undefined;
};

export type PartMark = {
  readonly given: readonly string[];
  readonly until?: string;
};

export type GivenAnswer = { readonly decision: "approve" } | { readonly decision: "choice"; readonly choice: string };

export const givenKind = "step.given";

export const givenBy = "a test, which gave this step's output";

const startedKind = "run.started";

function listed(ids: readonly string[]): string {
  return ids.join(", ");
}

function unknownGiven(name: string, ids: readonly string[], part: WorkflowPart): readonly string[] {
  return [...part.given.keys()]
    .filter((id) => !ids.includes(id))
    .map(
      (id) =>
        `The workflow ${name} has no step ${id} at its top level, so it cannot be given; ` +
        `its steps are ${listed(ids)}.`,
    );
}

function gapProblems(name: string, ids: readonly string[], part: WorkflowPart): readonly string[] {
  const firstRun = ids.find((id) => !part.given.has(id));
  if (firstRun === undefined) {
    return [];
  }
  const after = ids.slice(ids.indexOf(firstRun) + 1);
  return after
    .filter((id) => part.given.has(id))
    .map(
      (id) =>
        `Step ${id} of the workflow ${name} is given, but step ${firstRun} before it is not; ` +
        "a test gives every step from the first up to the one where the walk is to begin.",
    );
}

function untilProblems(name: string, ids: readonly string[], part: WorkflowPart): readonly string[] {
  const { until } = part;
  if (until === undefined) {
    return [];
  }
  if (!ids.includes(until)) {
    return [`The workflow ${name} has no step ${until} at its top level to stop after; its steps are ${listed(ids)}.`];
  }
  if (part.given.has(until)) {
    return [`The run is to stop after step ${until}, which is given, so no step would run; name a later step.`];
  }
  return [];
}

export function partProblems(name: string, steps: readonly WorkflowStep[], part: WorkflowPart): readonly string[] {
  const ids = steps.map((step) => step.id);
  return [...unknownGiven(name, ids, part), ...gapProblems(name, ids, part), ...untilProblems(name, ids, part)];
}

export function partMarkOf(part: WorkflowPart): PartMark {
  const given = [...part.given.keys()];
  return part.until === undefined ? { given } : { given, until: part.until };
}

export function markIn(events: readonly RunEvent[]): PartMark | undefined {
  const started = events.find((event) => event.kind === startedKind);
  const mark = started === undefined ? undefined : fieldOf(started.detail, "part");
  if (mark === undefined || !isRecord(mark)) {
    return undefined;
  }
  const until = textField(mark, "until");
  const given = textsField(mark, "given");
  return until === undefined ? { given } : { given, until };
}

export function untilIn(events: readonly RunEvent[]): string | undefined {
  return markIn(events)?.until;
}

export function untilQuestion(stepId: string): string {
  return (
    `A test started this run to stop after step ${stepId}, and it did: no later step starts, ` +
    "and resuming the run stops here again."
  );
}

export function isGivenStep(events: readonly RunEvent[], stepKey: string): boolean {
  return events.some((event) => event.kind === givenKind && textField(event.detail, "stepKey") === stepKey);
}

function shown(value: Json): string {
  return JSON.stringify(value);
}

function verdictAnswer(stepId: string, value: Json): GivenAnswer | string {
  return textField(value, "verdict") === "approve"
    ? { decision: "approve" }
    : `Step ${stepId} is an approval with no choices; give it as { "verdict": "approve" }, not ${shown(value)}.`;
}

function choiceAnswer(stepId: string, value: Json, choices: readonly ChoiceStatus[]): GivenAnswer | string {
  const names = choices.map((choice) => choice.name);
  const choice = textField(value, "choice");
  if (choice === undefined) {
    return `Step ${stepId} has choices; give it as { "choice": "<name>" } with one of ${listed(names)}, not ${shown(value)}.`;
  }
  const found = choices.find((each) => each.name === choice);
  if (found === undefined) {
    return `Step ${stepId} has no choice ${choice}; its choices are ${listed(names)}.`;
  }
  if (found.status === "withheld") {
    const offered = choices.filter((each) => each.status === "offered").map((each) => each.name);
    return (
      `Step ${stepId} withholds the choice ${choice}, by its rule over the steps given before it; ` +
      `give a choice it offers: ${offered.length === 0 ? "none" : listed(offered)}.`
    );
  }
  return { decision: "choice", choice };
}

export function givenAnswerOf(
  stepId: string,
  value: Json,
  choices: readonly ChoiceStatus[] | undefined,
): GivenAnswer | string {
  return choices === undefined ? verdictAnswer(stepId, value) : choiceAnswer(stepId, value, choices);
}

export function itemCountProblem(stepId: string, items: number, value: Json): string | undefined {
  if (Array.isArray(value) && value.length === items) {
    return undefined;
  }
  const given = Array.isArray(value) ? `a list of ${String(value.length)}` : shown(value);
  return `Step ${stepId} runs over ${String(items)} items, but its given output is ${given}; give one output for each item.`;
}
