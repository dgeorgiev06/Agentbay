import { fieldsOf, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";

export type TimeLimits = { readonly stepSeconds: number; readonly longestCallSeconds: number };

const defaultTimeLimits: TimeLimits = { stepSeconds: 1800, longestCallSeconds: 1000 };

const keptSeconds = 60;

const secondsPerOtherCall = 5;

const raisesTheStep = "settings.proof.stepSeconds in agentbay.config.yaml raises the step.";

export type Called = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly reason: string };

export type Copy = { readonly made: true; readonly folder: string } | { readonly made: false; readonly reason: string };

function wholeSecondsOr(value: Json | undefined, otherwise: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : otherwise;
}

export function timeLimitsOf(settings: Readonly<Record<string, Json>>): TimeLimits {
  return {
    stepSeconds: wholeSecondsOr(settings.stepSeconds, defaultTimeLimits.stepSeconds),
    longestCallSeconds: wholeSecondsOr(settings.longestCallSeconds, defaultTimeLimits.longestCallSeconds),
  };
}

export function secondsToAsk(limits: TimeLimits, spentSeconds: number, sharing: number): number {
  const left = (limits.stepSeconds - keptSeconds - spentSeconds) / Math.max(1, sharing);
  return Math.max(0, Math.min(limits.longestCallSeconds, Math.floor(left)));
}

export function noTimeLeftSentence(limits: TimeLimits, notDone: string): string {
  const step = String(limits.stepSeconds);
  return `Proof's own step of ${step} seconds had no time left for it, so it was not ${notDone}; ${raisesTheStep}`;
}

export function askedSentence(limits: TimeLimits, askedSeconds: number): string {
  const asked = `Proof asked for ${String(askedSeconds)} seconds`;
  if (askedSeconds >= limits.longestCallSeconds) {
    return `${asked}, the most it asks for one call; settings.proof.longestCallSeconds in agentbay.config.yaml raises it.`;
  }
  return `${asked}, what its step of ${String(limits.stepSeconds)} seconds had left for it; ${raisesTheStep}`;
}

export type Timed = { readonly askedSeconds: number; readonly tookSeconds: number };

export function reasonWithTheLimit(reason: string, limits: TimeLimits, timed: Timed): string {
  const stopped = timed.tookSeconds >= timed.askedSeconds;
  return stopped ? `${reason} ${askedSentence(limits, timed.askedSeconds)}` : reason;
}

function linksOf(settings: Readonly<Record<string, Json>>): readonly string[] {
  const links = settings.links;
  return Array.isArray(links) ? links.filter((link) => typeof link === "string") : [];
}

export class ProofStep {
  readonly context: ScriptContext;
  readonly links: readonly string[];
  readonly limits: TimeLimits;
  #spentSeconds = 0;
  #copiesMade = 0;

  constructor(context: ScriptContext) {
    this.context = context;
    this.links = linksOf(context.settings);
    this.limits = timeLimitsOf(context.settings);
  }

  secondsLeft(sharing: number): number {
    return secondsToAsk(this.limits, this.#spentSeconds, sharing);
  }

  spend(seconds: number): void {
    this.#spentSeconds += seconds;
  }

  async called(reference: string, input: Json): Promise<Called> {
    this.spend(secondsPerOtherCall);
    const answer = await this.context.call(reference, input);
    return answer.ok ? { ok: true, value: answer.value } : { ok: false, reason: answer.message };
  }

  copyName(): string {
    this.#copiesMade += 1;
    return `proof-${String(this.context.now().getTime())}-${String(this.#copiesMade)}`;
  }
}

function folderOf(value: Json): string {
  const folder = fieldsOf(value).folder;
  return typeof folder === "string" ? folder : "";
}

export async function inCopy<Result>(
  step: ProofStep,
  commit: string,
  use: (copy: Copy) => Promise<Result>,
): Promise<Result> {
  const made = await step.called("worktrees.copy", { commit, name: step.copyName(), links: step.links });
  if (!made.ok) {
    return use({ made: false, reason: `No copy of ${commit} could be made: ${made.reason}` });
  }
  const folder = folderOf(made.value);
  try {
    return await use({ made: true, folder });
  } finally {
    await step.called("worktrees.remove", { folder });
  }
}
