import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";
import type { ProofStep } from "./step.ts";

export type TestRun =
  | { readonly ran: "passed"; readonly passed: number }
  | { readonly ran: "failed"; readonly failed: number }
  | { readonly ran: "inconclusive"; readonly reason: string }
  | { readonly ran: "not started"; readonly reason: string };

export type CheckVerdict =
  | { readonly name: string; readonly verdict: "passed" | "failed" }
  | { readonly name: string; readonly verdict: "inconclusive"; readonly reason: string };

export type CheckRun =
  | { readonly ran: "ended"; readonly verdicts: readonly CheckVerdict[] }
  | { readonly ran: "not started"; readonly reason: string };

const noTimeLeft = "Proof's own step had no time left for it, so it was not made.";

function textOf(fields: JsonFields, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : "";
}

function numberOf(fields: JsonFields, name: string): number {
  const value = fields[name];
  return typeof value === "number" ? value : 0;
}

function testRunOf(value: Json): TestRun {
  const fields = fieldsOf(value);
  if (fields.verdict === "passed") {
    return { ran: "passed", passed: numberOf(fields, "passed") };
  }
  if (fields.verdict === "failed") {
    return { ran: "failed", failed: numberOf(fields, "failed") };
  }
  return { ran: "inconclusive", reason: textOf(fields, "reason") };
}

function checkVerdictOf(value: Json): CheckVerdict {
  const fields = fieldsOf(value);
  const name = textOf(fields, "name");
  const verdict = fields.verdict;
  if (verdict === "passed" || verdict === "failed") {
    return { name, verdict };
  }
  return { name, verdict: "inconclusive", reason: textOf(fields, "reason") };
}

function isList(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

function listOf(value: Json): readonly Json[] {
  return isList(value) ? value : [];
}

export async function testRun(step: ProofStep, folder: string, files?: readonly string[]): Promise<TestRun> {
  const seconds = step.secondsLeft();
  if (seconds < 1) {
    return { ran: "not started", reason: noTimeLeft };
  }
  const asked =
    files === undefined ? { folder, timeLimitSeconds: seconds } : { folder, files, timeLimitSeconds: seconds };
  const answer = await step.called("toolchain.test", asked);
  if (!answer.ok) {
    step.spend(seconds);
    return { ran: "not started", reason: answer.reason };
  }
  step.spend(numberOf(fieldsOf(answer.value), "seconds"));
  return testRunOf(answer.value);
}

export async function checkRun(step: ProofStep, folder: string, checks: number): Promise<CheckRun> {
  const seconds = Math.floor(step.secondsLeft() / Math.max(1, checks));
  if (seconds < 1) {
    return { ran: "not started", reason: noTimeLeft };
  }
  const answer = await step.called("toolchain.check", { folder, timeLimitSeconds: seconds });
  if (!answer.ok) {
    step.spend(seconds * Math.max(1, checks));
    return { ran: "not started", reason: answer.reason };
  }
  const verdicts = listOf(fieldsOf(answer.value).verdicts ?? null);
  step.spend(verdicts.reduce((total: number, verdict) => total + numberOf(fieldsOf(verdict), "seconds"), 0));
  return { ran: "ended", verdicts: verdicts.map(checkVerdictOf) };
}

export async function checkCount(step: ProofStep): Promise<number | undefined> {
  const described = await step.called("toolchain.describe", {});
  if (!described.ok) {
    return undefined;
  }
  return listOf(fieldsOf(described.value).checks ?? null).length;
}
