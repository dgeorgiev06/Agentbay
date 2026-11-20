import type { Json } from "../contracts.ts";
import type { Waiting } from "./run-state.ts";

export type ItemPhase = "queued" | "running" | "ended";

export type ItemEnd =
  | { readonly kind: "done"; readonly output: Json }
  | { readonly kind: "failed"; readonly key: string; readonly reason: string }
  | { readonly kind: "waiting"; readonly waits: readonly Waiting[] };

export type ForeachEnd =
  | { readonly kind: "done"; readonly outputs: readonly Json[] }
  | { readonly kind: "waiting"; readonly lead: Waiting; readonly others: readonly Waiting[] }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "asking"; readonly lead: Waiting; readonly others: readonly Waiting[]; readonly question: string };

export type ForeachPlace = {
  readonly stepId: string;
  readonly key: string;
  readonly stopped: boolean;
};

type Failure = {
  readonly index: number;
  readonly key: string;
  readonly reason: string;
};

const longestReason = 200;

const rerunHint = "Resume with --rerun to run the failed items again, or stop the run.";

export function itemsToStart(phases: readonly ItemPhase[], cap: number): readonly number[] {
  const running = phases.filter((phase) => phase === "running").length;
  const queued = phases.flatMap((phase, index) => (phase === "queued" ? [index] : []));
  return queued.slice(0, Math.max(0, cap - running));
}

export function cutReason(reason: string): string {
  return reason.length <= longestReason ? reason : `${reason.slice(0, longestReason - 1)}…`;
}

function failuresOf(ends: readonly ItemEnd[]): readonly Failure[] {
  return ends.flatMap((end, index) => (end.kind === "failed" ? [{ index, key: end.key, reason: end.reason }] : []));
}

export function failureSentence(stepId: string, ends: readonly ItemEnd[]): string {
  const failures = failuresOf(ends);
  const named = failures.map(
    (failure) => `item ${String(failure.index)} (${failure.key}): ${cutReason(failure.reason)}`,
  );
  const counted = `${String(failures.length)} of ${String(ends.length)} items`;
  return `Step ${stepId} failed for ${counted}: ${named.join("; ")}`;
}

function itemWaits(ends: readonly ItemEnd[]): readonly Waiting[] {
  return ends.flatMap((end) => (end.kind === "waiting" ? end.waits : []));
}

function outputsOf(ends: readonly ItemEnd[]): readonly Json[] {
  return ends.flatMap((end) => (end.kind === "done" ? [end.output] : []));
}

export function foreachEnd(ends: readonly ItemEnd[], place: ForeachPlace): ForeachEnd {
  const [lead, ...others] = itemWaits(ends);
  if (failuresOf(ends).length === 0) {
    return lead === undefined ? { kind: "done", outputs: outputsOf(ends) } : { kind: "waiting", lead, others };
  }
  const sentence = failureSentence(place.stepId, ends);
  if (place.stopped) {
    return { kind: "failed", reason: sentence };
  }
  const question = `${sentence} ${rerunHint}`;
  const asked: Waiting = { reason: "owner", stepKey: place.key, question };
  return lead === undefined
    ? { kind: "asking", lead: asked, others: [], question }
    : { kind: "asking", lead, others: [...others, asked], question };
}

export function attemptsAfterRerun(attempts: readonly number[], ends: readonly ItemEnd[]): readonly number[] {
  return attempts.map((attempt, index) => (ends[index]?.kind === "failed" ? attempt + 1 : attempt));
}

export function itemsRerun(before: readonly number[], after: readonly number[]): readonly number[] {
  return after.flatMap((attempt, index) => (attempt === before[index] ? [] : [index]));
}
