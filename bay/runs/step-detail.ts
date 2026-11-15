import { noSpend, spendFromJson } from "./budget.ts";
import type { Json, Spend, Submission, Tier } from "../contracts.ts";
import { fieldOf, numberField, textField, textsField } from "../json.ts";

export const stepKinds = ["script", "check", "skill", "call", "action", "undo", "approval", "wait", "foreach"] as const;

export type StepKind = (typeof stepKinds)[number];

export type ScriptDetail = {
  readonly script: string;
  readonly stoppedForCall?: Spend;
};

export type SkillDetail = {
  readonly mode: string;
  readonly action: string;
  readonly skill: string;
  readonly tier: Tier;
  readonly schemas: readonly string[];
  readonly round: number;
  readonly feedback: readonly string[];
  readonly earlierSpent: Spend;
  readonly calledSpent: Spend;
  readonly submission?: Submission;
};

type NestedDetail = {
  readonly mode: string;
  readonly action: string;
  readonly caller?: string;
};

type ApprovalVerdict = {
  readonly decision: "approve" | "reject";
  readonly by: string;
};

export type ApprovalDetail = {
  readonly question: string;
  readonly hash: string;
  readonly previousHash?: string;
  readonly shown?: Json;
  readonly verdict?: ApprovalVerdict;
};

type WaitDetail = {
  readonly until: string;
};

export type StepDetail =
  | { readonly kind: "script" | "check"; readonly detail: ScriptDetail }
  | { readonly kind: "skill"; readonly detail: SkillDetail }
  | { readonly kind: "call" | "action" | "undo"; readonly detail: NestedDetail }
  | { readonly kind: "approval"; readonly detail: ApprovalDetail }
  | { readonly kind: "wait"; readonly detail: WaitDetail }
  | { readonly kind: "foreach"; readonly detail: null };

export type RefusedDetail = {
  readonly kind: StepKind;
  readonly detail: null;
};

const tiers: readonly Tier[] = ["fast", "balanced", "deep"];

const decisions: readonly ApprovalVerdict["decision"][] = ["approve", "reject"];

function malformed(kind: StepKind, field: string): Error {
  return new Error(`kernel.db holds a ${kind} step whose detail has no valid ${field}.`);
}

function requiredText(value: Json, field: string, kind: StepKind): string {
  const text = textField(value, field);
  if (text === undefined) {
    throw malformed(kind, field);
  }
  return text;
}

function requiredNumber(value: Json, field: string, kind: StepKind): number {
  const number = numberField(value, field);
  if (number === undefined) {
    throw malformed(kind, field);
  }
  return number;
}

function optionalSpend(value: Json, field: string): Spend | undefined {
  const spend = fieldOf(value, field);
  return spend === undefined ? undefined : spendFromJson(spend);
}

function scriptDetailOf(value: Json, kind: StepKind): ScriptDetail {
  const stoppedForCall = optionalSpend(value, "stoppedForCall");
  return {
    script: requiredText(value, "script", kind),
    ...(stoppedForCall === undefined ? {} : { stoppedForCall }),
  };
}

function submissionOf(value: Json): Submission | undefined {
  const submission = fieldOf(value, "submission");
  const output = submission === undefined ? undefined : fieldOf(submission, "output");
  if (submission === undefined || output === undefined) {
    return undefined;
  }
  return { output, spent: spendFromJson(fieldOf(submission, "spent") ?? {}) };
}

function tierOf(value: Json): Tier {
  const tier = tiers.find((candidate) => candidate === textField(value, "tier"));
  if (tier === undefined) {
    throw malformed("skill", "tier");
  }
  return tier;
}

function skillDetailOf(value: Json): SkillDetail {
  const submission = submissionOf(value);
  return {
    mode: requiredText(value, "mode", "skill"),
    action: requiredText(value, "action", "skill"),
    skill: requiredText(value, "skill", "skill"),
    tier: tierOf(value),
    schemas: textsField(value, "schemas"),
    round: requiredNumber(value, "round", "skill"),
    feedback: textsField(value, "feedback"),
    earlierSpent: optionalSpend(value, "earlierSpent") ?? noSpend,
    calledSpent: optionalSpend(value, "calledSpent") ?? noSpend,
    ...(submission === undefined ? {} : { submission }),
  };
}

function nestedDetailOf(value: Json, kind: StepKind): NestedDetail {
  const caller = textField(value, "caller");
  return {
    mode: requiredText(value, "mode", kind),
    action: requiredText(value, "action", kind),
    ...(caller === undefined ? {} : { caller }),
  };
}

function verdictOf(value: Json): ApprovalVerdict | undefined {
  const verdict = fieldOf(value, "verdict");
  const decision = decisions.find((candidate) => candidate === textField(verdict ?? null, "decision"));
  const by = textField(verdict ?? null, "by");
  return decision === undefined || by === undefined ? undefined : { decision, by };
}

function approvalDetailOf(value: Json): ApprovalDetail {
  const previousHash = textField(value, "previousHash");
  const shown = fieldOf(value, "shown");
  const verdict = verdictOf(value);
  return {
    question: requiredText(value, "question", "approval"),
    hash: requiredText(value, "hash", "approval"),
    ...(previousHash === undefined ? {} : { previousHash }),
    ...(shown === undefined ? {} : { shown }),
    ...(verdict === undefined ? {} : { verdict }),
  };
}

export function decodedStepDetail(kind: StepKind, value: Json): StepDetail {
  switch (kind) {
    case "script":
    case "check":
      return { kind, detail: scriptDetailOf(value, kind) };
    case "skill":
      return { kind, detail: skillDetailOf(value) };
    case "call":
    case "action":
    case "undo":
      return { kind, detail: nestedDetailOf(value, kind) };
    case "approval":
      return { kind, detail: approvalDetailOf(value) };
    case "wait":
      return { kind, detail: { until: requiredText(value, "until", kind) } };
    case "foreach":
      return { kind, detail: null };
  }
}

export function stepDetailJson(step: StepDetail | RefusedDetail): Json {
  return step.detail;
}
