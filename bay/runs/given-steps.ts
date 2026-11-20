import type { Json, Scrubber } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import type { Keeping } from "../generated/mode.ts";
import { toJson } from "../json.ts";
import type { ActionTarget, ReferenceScope, System, WorkflowTarget } from "../manifests/manifests.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import { evaluatedChoices, type ChoiceStatus } from "./choices.ts";
import { keepingOf } from "./packed-output.ts";
import { approvalContentOf } from "./scrubbed-store.ts";
import type { StepDetail } from "./step-detail.ts";
import { workflowStepKey } from "./step-key.ts";
import { givenAnswerOf, givenBy, itemCountProblem, partProblems, type WorkflowPart } from "./workflow-part.ts";

export type GivenRecord = StepDetail & {
  readonly key: string;
  readonly input: Json;
  readonly kept?: Keeping;
  readonly output: Json;
};

export type Giving = {
  readonly system: System;
  readonly scrubber: Scrubber;
  readonly workflow: WorkflowTarget;
  readonly trigger: Json;
};

type GivenAt<T> = {
  readonly giving: Giving;
  readonly scope: ReferenceScope;
  readonly previous: Json;
  readonly step: T;
  readonly value: Json;
};

type ActionStep = Extract<WorkflowStep, { readonly action: string }>;

type ApprovalStep = Extract<WorkflowStep, { readonly approval: string }>;

type ForeachStep = Extract<WorkflowStep, { readonly foreach: string }>;

type Check = (value: Json) => string | undefined;

function targetOf(giving: Giving, action: string): ActionTarget | string {
  const answer = giving.system.action(action, giving.workflow.mode.manifest.name);
  return answer.ok ? answer.value : problemText(answer.problems);
}

function resolved(at: GivenAt<WorkflowStep>, value: Readonly<Record<string, unknown>> | string): Json | string {
  const answer = at.giving.workflow.resolve(value, at.scope);
  if (answer.ok) {
    return answer.value;
  }
  return `Step ${at.step.id} is given, but what it reads cannot be worked out from the steps given before it: ${problemText(answer.problems)}`;
}

function schemaCheck(target: ActionTarget, stepId: string): Check {
  return (value) => {
    const checked = target.output.check(value);
    if (checked.ok) {
      return undefined;
    }
    const action = `${target.mode.manifest.name}.${target.name}`;
    return (
      `The output given for step ${stepId} does not match the output schema of ${action}: ` +
      problemText(checked.problems)
    );
  };
}

function givenAction(at: GivenAt<ActionStep>): GivenRecord | string {
  const target = targetOf(at.giving, at.step.action);
  if (typeof target === "string") {
    return target;
  }
  const input = at.step.input === undefined ? at.previous : resolved(at, at.step.input);
  if (typeof input === "string") {
    return input;
  }
  const problem = schemaCheck(target, at.step.id)(at.value);
  if (problem !== undefined) {
    return problem;
  }
  const caller = target.caller === undefined ? {} : { caller: target.caller };
  const detail = { mode: target.mode.manifest.name, action: target.name, ...caller };
  const key = workflowStepKey("", at.step.id);
  return { key, kind: "action", input, kept: keepingOf(target.action), detail, output: at.value };
}

function choicesOf(at: GivenAt<ApprovalStep>): readonly ChoiceStatus[] | string | undefined {
  const choices = at.step.choices;
  if (choices === undefined) {
    return undefined;
  }
  const resolve = (rule: string): Outcome<Json> => at.giving.workflow.resolve(rule, at.scope);
  const evaluated = evaluatedChoices({ stepId: at.step.id, choices, resolve });
  return evaluated.ok ? evaluated.value : problemText(evaluated.problems);
}

function givenApproval(at: GivenAt<ApprovalStep>): GivenRecord | string {
  const content = at.step.show === undefined ? at.previous : resolved(at, at.step.show);
  if (typeof content === "string") {
    return content;
  }
  const choices = choicesOf(at);
  if (typeof choices === "string") {
    return choices;
  }
  const answer = givenAnswerOf(at.step.id, at.value, choices);
  if (typeof answer === "string") {
    return answer;
  }
  const shown = approvalContentOf(content, at.giving.scrubber);
  const output = answer.decision === "choice" ? { choice: answer.choice, content: shown.content } : shown.content;
  const verdict = { ...answer, by: givenBy };
  const detail = {
    question: at.step.approval,
    hash: shown.hash,
    ...(choices === undefined ? {} : { choices }),
    verdict,
  };
  const key = workflowStepKey("", at.step.id);
  return { key, kind: "approval", input: shown.content, detail, output };
}

function cannotCheck(stepId: string, last: WorkflowStep): string {
  return (
    `Step ${stepId} ends in step ${last.id}, whose output has no schema, so a given output of ${stepId} ` +
    "cannot be checked; give only the steps before it."
  );
}

function listCheck(each: Check): Check {
  return (value) => {
    const elements: readonly unknown[] = Array.isArray(value) ? value : [];
    const problems = elements.map((element) => each(toJson(element)));
    return problems.find((problem) => problem !== undefined);
  };
}

function itemCheck(giving: Giving, step: ForeachStep): Check | string {
  const last = step.steps.at(-1);
  if (last === undefined) {
    return cannotCheck(step.id, step);
  }
  if ("action" in last) {
    const target = targetOf(giving, last.action);
    return typeof target === "string" ? target : schemaCheck(target, step.id);
  }
  if ("foreach" in last) {
    const inner = itemCheck(giving, last);
    return typeof inner === "string" ? inner : listCheck(inner);
  }
  return cannotCheck(step.id, last);
}

function givenForeach(at: GivenAt<ForeachStep>): GivenRecord | string {
  const items = resolved(at, at.step.foreach);
  if (typeof items === "string") {
    return items;
  }
  const count = Array.isArray(items) ? items.length : 0;
  const check = itemCheck(at.giving, at.step);
  if (typeof check === "string") {
    return check;
  }
  const problem = itemCountProblem(at.step.id, count, at.value) ?? listCheck(check)(at.value);
  if (problem !== undefined) {
    return problem;
  }
  const key = workflowStepKey("", at.step.id);
  return { key, kind: "foreach", input: items, detail: null, output: at.value };
}

function givenRecordOf(at: GivenAt<WorkflowStep>): GivenRecord | string {
  const { step } = at;
  if ("action" in step) {
    return givenAction({ ...at, step });
  }
  if ("approval" in step) {
    return givenApproval({ ...at, step });
  }
  if ("foreach" in step) {
    return givenForeach({ ...at, step });
  }
  return `Step ${step.id} is a wait, which a test cannot give; give only the steps before it.`;
}

export function givenRecords(giving: Giving, part: WorkflowPart): Outcome<readonly GivenRecord[]> {
  const { workflow } = giving.workflow;
  const problems = partProblems(workflow.name, workflow.steps, part);
  if (problems.length > 0) {
    return failedWith(problems.map((message) => unplacedProblem(message)));
  }
  const outputs = new Map<string, Json>();
  const records: GivenRecord[] = [];
  let previous = giving.trigger;
  for (const step of workflow.steps.filter((each) => part.given.has(each.id))) {
    const scope = { trigger: giving.trigger, outputs };
    const value = part.given.get(step.id) ?? null;
    const record = givenRecordOf({ giving, scope, previous, step, value });
    if (typeof record === "string") {
      return failedWith([unplacedProblem(record)]);
    }
    records.push(record);
    outputs.set(step.id, record.output);
    previous = record.output;
  }
  return succeededWith(records);
}
