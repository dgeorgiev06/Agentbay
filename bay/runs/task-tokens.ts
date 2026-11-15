import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RunStore, StoredState, TaskTokenStore } from "./run-store.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";

export type TaskPlace = {
  readonly runId: string;
  readonly stepKey: string;
  readonly round: number;
};

type TokenStores = {
  readonly tokens: TaskTokenStore;
  readonly runs: Pick<RunStore, "readRun">;
};

const tokenBytes = 32;

const unknownToken =
  "The token is not valid: it was never issued, or a newer token for the same task replaced it. " +
  "Ask the coordinator for the task again; it carries a fresh token.";

function refusedToken(reason: string): Outcome<never> {
  return failedWith([unplacedProblem(reason)]);
}

function hashOf(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function isWaitingAt(state: StoredState, stepKey: string): boolean {
  return state.status === "waiting" && state.reason === "skill" && state.stepKey === stepKey;
}

function deadReason(place: TaskPlace, state: StoredState): string {
  const now = state.status === "waiting" ? `waiting for ${state.reason} at ${state.stepKey}` : state.status;
  return (
    `The token was issued for step ${place.stepKey} of run ${place.runId}, which is no longer waiting for it ` +
    `(the run is ${now}); a token dies when its step finishes or its round changes.`
  );
}

export async function issueTaskToken(store: TaskTokenStore, place: TaskPlace, now: Date): Promise<string> {
  const token = randomBytes(tokenBytes).toString("base64url");
  await store.replaceTaskToken({ ...place, hash: hashOf(token).toString("hex"), issuedAt: now.toISOString() });
  return token;
}

async function storedPlace(store: TaskTokenStore, token: string): Promise<TaskPlace | undefined> {
  const presented = hashOf(token);
  let found: TaskPlace | undefined;
  for (const stored of await store.taskTokens()) {
    const candidate = Buffer.from(stored.hash, "hex");
    const same = candidate.length === presented.length && timingSafeEqual(candidate, presented);
    if (same) {
      found = { runId: stored.runId, stepKey: stored.stepKey, round: stored.round };
    }
  }
  return found;
}

export async function checkTaskToken(stores: TokenStores, token: string): Promise<Outcome<TaskPlace>> {
  const place = await storedPlace(stores.tokens, token);
  if (place === undefined) {
    return refusedToken(unknownToken);
  }
  const run = await stores.runs.readRun(place.runId);
  if (run === undefined) {
    return refusedToken(unknownToken);
  }
  if (!isWaitingAt(run.state, place.stepKey)) {
    await stores.tokens.removeTaskTokens(place.runId);
    return refusedToken(deadReason(place, run.state));
  }
  return succeededWith(place);
}
