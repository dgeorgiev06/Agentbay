import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import { noTimeLeftSentence, reasonWithTheLimit, type ProofStep, type TimeLimits } from "./step.ts";

export type FailingCase = {
  readonly name: string;
  readonly file: string;
  readonly message: string;
  readonly charactersCut: number;
};

export type Cases = {
  readonly failures?: readonly FailingCase[];
  readonly failuresNotListed?: number;
  readonly notLoaded?: readonly string[];
};

export type TestRun =
  | { readonly ran: "passed"; readonly passed: number }
  | { readonly ran: "failed"; readonly failed: number; readonly cases: Cases }
  | { readonly ran: "inconclusive"; readonly reason: string }
  | { readonly ran: "not started"; readonly reason: string };

export type CheckVerdict =
  | { readonly name: string; readonly verdict: "passed" | "failed" }
  | { readonly name: string; readonly verdict: "inconclusive"; readonly reason: string };

export type CheckRun =
  | { readonly ran: "ended"; readonly verdicts: readonly CheckVerdict[] }
  | { readonly ran: "not started"; readonly reason: string };

function textOf(fields: JsonFields, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : "";
}

function numberOf(fields: JsonFields, name: string): number {
  const value = fields[name];
  return typeof value === "number" ? value : 0;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function listOf(value: Json | undefined): readonly Json[] {
  return isList(value) ? value : [];
}

function failingCaseOf(value: Json): FailingCase {
  const fields = fieldsOf(value);
  return {
    name: textOf(fields, "name"),
    file: textOf(fields, "file"),
    message: textOf(fields, "message"),
    charactersCut: numberOf(fields, "charactersCut"),
  };
}

function casesOf(fields: JsonFields): Cases {
  const { failures, failuresNotListed, notLoaded } = fields;
  return {
    ...(isList(failures) ? { failures: failures.map(failingCaseOf) } : {}),
    ...(typeof failuresNotListed === "number" ? { failuresNotListed } : {}),
    ...(isList(notLoaded) ? { notLoaded: notLoaded.filter((file) => typeof file === "string") } : {}),
  };
}

type Answered = { readonly value: Json; readonly askedSeconds: number };

function unknownReason(fields: JsonFields, limits: TimeLimits, askedSeconds: number): string {
  const timed = { askedSeconds, tookSeconds: numberOf(fields, "seconds") };
  return reasonWithTheLimit(textOf(fields, "reason"), limits, timed);
}

function testRunOf(answered: Answered, limits: TimeLimits): TestRun {
  const fields = fieldsOf(answered.value);
  if (fields.verdict === "passed") {
    return { ran: "passed", passed: numberOf(fields, "passed") };
  }
  if (fields.verdict === "failed") {
    return { ran: "failed", failed: numberOf(fields, "failed"), cases: casesOf(fields) };
  }
  return { ran: "inconclusive", reason: unknownReason(fields, limits, answered.askedSeconds) };
}

function checkVerdictOf(answered: Answered, limits: TimeLimits): CheckVerdict {
  const fields = fieldsOf(answered.value);
  const name = textOf(fields, "name");
  const verdict = fields.verdict;
  if (verdict === "passed" || verdict === "failed") {
    return { name, verdict };
  }
  return { name, verdict: "inconclusive", reason: unknownReason(fields, limits, answered.askedSeconds) };
}

export async function testRun(step: ProofStep, folder: string, files?: readonly string[]): Promise<TestRun> {
  const seconds = step.secondsLeft(1);
  if (seconds < 1) {
    return { ran: "not started", reason: noTimeLeftSentence(step.limits, "made") };
  }
  const asked =
    files === undefined ? { folder, timeLimitSeconds: seconds } : { folder, files, timeLimitSeconds: seconds };
  const answer = await step.called("toolchain.test", asked);
  if (!answer.ok) {
    step.spend(seconds);
    return { ran: "not started", reason: answer.reason };
  }
  step.spend(numberOf(fieldsOf(answer.value), "seconds"));
  return testRunOf({ value: answer.value, askedSeconds: seconds }, step.limits);
}

export async function checkRun(step: ProofStep, folder: string, checks: number): Promise<CheckRun> {
  const seconds = step.secondsLeft(checks);
  if (seconds < 1) {
    return { ran: "not started", reason: noTimeLeftSentence(step.limits, "made") };
  }
  const answer = await step.called("toolchain.check", { folder, timeLimitSeconds: seconds });
  if (!answer.ok) {
    step.spend(seconds * Math.max(1, checks));
    return { ran: "not started", reason: answer.reason };
  }
  const verdicts = listOf(fieldsOf(answer.value).verdicts);
  step.spend(verdicts.reduce((total: number, verdict) => total + numberOf(fieldsOf(verdict), "seconds"), 0));
  const verdictOfCheck = (value: Json): CheckVerdict => checkVerdictOf({ value, askedSeconds: seconds }, step.limits);
  return { ran: "ended", verdicts: verdicts.map(verdictOfCheck) };
}

export async function checkCount(step: ProofStep): Promise<number | undefined> {
  const described = await step.called("toolchain.describe", {});
  if (!described.ok) {
    return undefined;
  }
  return listOf(fieldsOf(described.value).checks).length;
}
