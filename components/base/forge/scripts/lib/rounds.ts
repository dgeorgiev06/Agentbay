import { fail, fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { builtOf, type Built } from "./builder-answer.ts";
import { sliceOf } from "./slice-form.ts";
import type { Failing, FailingCase } from "./failing.ts";
import { leaksOf, type Leak } from "./leaks.ts";
import { quotesAny } from "./quoting.ts";
import { reviewOf, type Condition, type Finding, type Review } from "./review.ts";
import { listOf, numberOf, textOf, textsOf } from "./json-values.ts";

export const lastRound = 3;

export type Work = {
  readonly branch: string;
  readonly commit: string;
};

export type Remaining = Pick<Finding, "to" | "case" | "question"> & { readonly fix?: string };

export type RoundsState = {
  readonly round: number;
  readonly stage: "proved" | "reviewed";
  readonly done: boolean;
  readonly base: string;
  readonly built: Built;
  readonly builder: Work;
  readonly head: string;
  readonly branch: string;
  readonly folder?: string;
  readonly declared: Json;
  readonly tests: readonly string[];
  readonly verdicts: readonly Json[];
  readonly failing: Failing;
  readonly toBuilder: readonly Finding[];
  readonly toTests: number;
  readonly conditions: readonly Condition[];
  readonly remaining: readonly Remaining[];
  readonly leaks: readonly Leak[];
  readonly builtAt?: string;
  readonly reviewedAt?: string;
};

export type AfterRound = {
  readonly name: string;
  readonly slice: Json;
  readonly fixed: readonly string[];
  readonly state: RoundsState;
};

export type RoundPlan = {
  readonly writeTests: boolean;
  readonly build: boolean;
};

export type ReviewPlan = "pass-on" | "leaked" | "stopped" | "failing" | "review";

export type Reviewed =
  | { readonly plan: "leaked" | "stopped" | "failing" }
  | { readonly plan: "review"; readonly review: Review; readonly remaining: readonly Remaining[] };

function workOf(value: Json | undefined): Work {
  const fields = fieldsOf(value ?? null);
  return { branch: textOf(fields.branch), commit: textOf(fields.commit) };
}

function failingCaseOf(value: Json): FailingCase {
  const fields = fieldsOf(value);
  const named = { name: textOf(fields.name) };
  const file = typeof fields.file === "string" ? { file: fields.file } : {};
  const message = typeof fields.message === "string" ? { message: fields.message } : {};
  return { ...named, ...file, ...message };
}

function failingOf(value: Json | undefined): Failing {
  const fields = fieldsOf(value ?? null);
  return {
    items: listOf(fields.items).map(textOf),
    cases: listOf(fields.cases).map(failingCaseOf),
    withheld: numberOf(fields.withheld),
    notListed: numberOf(fields.notListed),
    notLoaded: listOf(fields.notLoaded).map(textOf),
  };
}

function keptOf(finding: Finding): Remaining {
  return { to: finding.to, case: finding.case, question: finding.question };
}

function remainingOf(value: Json): Remaining {
  const [finding] = reviewOf({ findings: [value] }).findings;
  if (finding === undefined) {
    return { to: "builder", case: "", question: "" };
  }
  return finding.fix === "" ? keptOf(finding) : { ...keptOf(finding), fix: finding.fix };
}

export function findingsLeft(findings: readonly Finding[], tests: readonly string[]): readonly Remaining[] {
  return findings.map((finding) =>
    quotesAny(finding.fix, tests) ? keptOf(finding) : { ...keptOf(finding), fix: finding.fix },
  );
}

function optionalText(
  fields: JsonFields,
  key: "folder" | "builtAt" | "reviewedAt",
): Partial<Record<typeof key, string>> {
  const value = fields[key];
  return typeof value === "string" ? { [key]: value } : {};
}

export function roundsStateOf(value: Json | undefined): RoundsState | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const fields = fieldsOf(value);
  return {
    round: numberOf(fields.round),
    stage: fields.stage === "reviewed" ? "reviewed" : "proved",
    done: fields.done === true,
    base: textOf(fields.base),
    built: builtOf(fields.built),
    builder: workOf(fields.builder),
    head: textOf(fields.head),
    branch: textOf(fields.branch),
    ...optionalText(fields, "folder"),
    declared: fields.declared ?? null,
    tests: listOf(fields.tests).map(textOf),
    verdicts: listOf(fields.verdicts),
    failing: failingOf(fields.failing),
    toBuilder: reviewOf({ findings: fields.toBuilder ?? [] }).findings,
    toTests: numberOf(fields.toTests),
    conditions: reviewOf({ conditions: fields.conditions ?? [] }).conditions,
    remaining: listOf(fields.remaining).map(remainingOf),
    leaks: leaksOf(fields.leaks),
    ...optionalText(fields, "builtAt"),
    ...optionalText(fields, "reviewedAt"),
  };
}

function isFailing(failing: Failing): boolean {
  return failing.items.length > 0;
}

export function roundPlan(before: RoundsState | undefined): RoundPlan | undefined {
  if (before === undefined) {
    return { writeTests: true, build: true };
  }
  if (before.done) {
    return undefined;
  }
  return { writeTests: before.toTests > 0, build: before.toBuilder.length > 0 || isFailing(before.failing) };
}

export function reviewPlan(state: RoundsState): ReviewPlan {
  if (state.stage === "reviewed") {
    return "pass-on";
  }
  if (state.leaks.length > 0) {
    return "leaked";
  }
  if (state.built.outcome === "stopped") {
    return "stopped";
  }
  return isFailing(state.failing) && state.round < lastRound ? "failing" : "review";
}

function withoutFolder(state: RoundsState): RoundsState {
  const { folder, ...rest } = state;
  return folder === undefined ? state : rest;
}

function afterReview(
  state: RoundsState,
  reviewed: Extract<Reviewed, { readonly plan: "review" }>,
  at: string,
): RoundsState {
  const { review, remaining } = reviewed;
  const done = state.round >= lastRound || review.findings.length === 0;
  const toBuilder = review.findings.filter((finding) => finding.to === "builder");
  return {
    ...state,
    done,
    toBuilder: done ? [] : toBuilder,
    toTests: done ? 0 : review.findings.length - toBuilder.length,
    conditions: review.conditions,
    remaining: done ? remaining : [],
    reviewedAt: at,
  };
}

export function reviewedState(state: RoundsState, reviewed: Reviewed, at: string): RoundsState {
  const cleared = { ...withoutFolder(state), stage: "reviewed" as const, toBuilder: [], toTests: 0, remaining: [] };
  switch (reviewed.plan) {
    case "leaked":
    case "stopped":
      return { ...cleared, done: true };
    case "failing":
      return { ...cleared, done: false };
    case "review":
      return afterReview(cleared, reviewed, at);
  }
}

export function afterRoundOf(fields: JsonFields, action: string): AfterRound {
  const slice = fields.slice ?? null;
  return {
    name: sliceOf(slice).name,
    slice,
    fixed: textsOf(fields.fixed),
    state: roundsStateOf(fields.state) ?? fail(`${action} was given no state of the rounds.`),
  };
}
