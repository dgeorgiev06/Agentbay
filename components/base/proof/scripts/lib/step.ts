import { fieldsOf, type Json, type ScriptContext } from "../../../../../bay/sdk.ts";

export const stepSeconds = 1800;

export const longestCallSeconds = 1000;

export const keptSeconds = 60;

export const secondsPerOtherCall = 5;

export type Called = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly reason: string };

export type Copy = { readonly made: true; readonly folder: string } | { readonly made: false; readonly reason: string };

const linkedIntoEveryCopy = ["node_modules"];

export function secondsToAsk(spentSeconds: number, sharing: number): number {
  const left = (stepSeconds - keptSeconds - spentSeconds) / Math.max(1, sharing);
  return Math.max(0, Math.min(longestCallSeconds, Math.floor(left)));
}

export class ProofStep {
  readonly context: ScriptContext;
  #spentSeconds = 0;
  #copiesMade = 0;

  constructor(context: ScriptContext) {
    this.context = context;
  }

  secondsLeft(sharing: number): number {
    return secondsToAsk(this.#spentSeconds, sharing);
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
  const made = await step.called("worktrees.copy", { commit, name: step.copyName(), links: linkedIntoEveryCopy });
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
