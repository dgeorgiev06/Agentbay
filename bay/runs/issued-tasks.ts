import type { Clock } from "../ports.ts";
import { storedWaits, type StoredState, type TaskTokenStore } from "./run-store.ts";
import type { SkillTask, Waiting } from "./run-state.ts";
import { issueTaskToken } from "./task-tokens.ts";

type IssuedTask = SkillTask & {
  readonly token?: string;
};

type Issuing = {
  readonly tokens: TaskTokenStore;
  readonly clock: Clock;
  readonly issue: (waitingKey: string) => boolean;
};

async function issuedWait(issuing: Issuing, waiting: Waiting): Promise<Waiting<IssuedTask>> {
  if (waiting.reason !== "skill" || !issuing.issue(waiting.stepKey)) {
    return waiting;
  }
  const { runId, round } = waiting.task;
  const place = { runId, stepKey: waiting.stepKey, round };
  const token = await issueTaskToken(issuing.tokens, place, issuing.clock.now());
  return { ...waiting, task: { ...waiting.task, token } };
}

export async function issuedWaits(issuing: Issuing, waits: readonly Waiting[]): Promise<Waiting<IssuedTask>[]> {
  const issued: Waiting<IssuedTask>[] = [];
  for (const waiting of waits) {
    issued.push(await issuedWait(issuing, waiting));
  }
  return issued;
}

export function skillKeysOf(state: StoredState | undefined): ReadonlySet<string> {
  const waits = state === undefined ? [] : storedWaits(state);
  return new Set(waits.filter((wait) => wait.reason === "skill").map((wait) => wait.stepKey));
}

export function taskAtKey<Task extends SkillTask>(waits: readonly Waiting<Task>[], stepKey: string): Task | undefined {
  const found = waits.find((waiting) => waiting.reason === "skill" && waiting.stepKey === stepKey);
  return found?.reason === "skill" ? found.task : undefined;
}
