import type { EventSink, Json, RunEvent, Settled, Spend } from "./contracts.ts";
import type { Budget } from "./generated/mode.ts";
import type { RefusedDetail, StepDetail, StepKind } from "./step-detail.ts";

export const kernelDatabaseFile = ".agentbay/kernel.db";

export const lockStaleMilliseconds = 10 * 60 * 1000;

export const runStatuses = ["running", "waiting", "done", "failed", "undone"] as const;

export type RunStatusName = (typeof runStatuses)[number];

export const waitingReasons = ["skill", "approval", "time", "budget", "owner"] as const;

export type WaitingReason = (typeof waitingReasons)[number];

export type RunTarget =
  | { readonly kind: "action"; readonly mode: string; readonly name: string; readonly caller?: string }
  | { readonly kind: "workflow"; readonly mode: string; readonly name: string };

export type StoredState =
  | { readonly status: "running" }
  | { readonly status: "waiting"; readonly reason: WaitingReason; readonly stepKey: string; readonly until?: string }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "undone"; readonly reason: string; readonly undo: Json };

type StepStartFields = {
  readonly key: string;
  readonly input: Json;
  readonly startedAt: string;
};

type StepEndFields = {
  readonly spent: Spend;
  readonly finishOrder: number;
  readonly finishedAt: string;
};

type StepProgress = { readonly status: "started" } | (StepEndFields & Settled);

export type StepRecord =
  | (StepStartFields & StepDetail & StepProgress)
  | (StepStartFields & RefusedDetail & StepEndFields & { readonly status: "failed"; readonly reason: string });

export type StoredRun = {
  readonly id: string;
  readonly target: RunTarget;
  readonly input: Json;
  readonly state: StoredState;
  readonly limit: Budget;
  readonly extra: Budget;
  readonly spent: Spend;
  readonly stopReason: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type RunWithSteps = StoredRun & { readonly steps: readonly StepRecord[] };

export type NewRun = {
  readonly id: string;
  readonly target: RunTarget;
  readonly input: Json;
  readonly limit: Budget;
  readonly at: string;
};

export type Writer = {
  readonly runId: string;
  readonly owner: string;
};

export type StepStart = StepDetail & {
  readonly key: string;
  readonly input: Json;
  readonly at: string;
};

export type StepEnd = Settled & {
  readonly key: string;
  readonly spent: Spend;
  readonly at: string;
};

export type StepChange = StepDetail & {
  readonly key: string;
  readonly at: string;
};

export type StepRefusal = {
  readonly key: string;
  readonly kind: StepKind;
  readonly input: Json;
  readonly reason: string;
  readonly at: string;
};

export type RunPatch = {
  readonly state?: StoredState;
  readonly extra?: Budget;
  readonly spent?: Spend;
  readonly stopReason?: string;
  readonly at: string;
};

export type LockResult =
  | { readonly status: "acquired"; readonly writer: Writer }
  | { readonly status: "held"; readonly owner: string; readonly heartbeatAt: string }
  | { readonly status: "missing" }
  | { readonly status: "busy" };

export type RunStore = EventSink & {
  readonly createRun: (run: NewRun, owner: string, events: readonly RunEvent[]) => Promise<Writer>;
  readonly saveStepInput: (writer: Writer, start: StepStart, events: readonly RunEvent[]) => Promise<StepRecord>;
  readonly saveStepOutput: (writer: Writer, end: StepEnd, events: readonly RunEvent[]) => Promise<StepRecord>;
  readonly saveStepDetail: (writer: Writer, change: StepChange, events: readonly RunEvent[]) => Promise<StepRecord>;
  readonly saveRefusal: (writer: Writer, refusal: StepRefusal, events: readonly RunEvent[]) => Promise<StepRecord>;
  readonly updateRun: (writer: Writer, patch: RunPatch, events: readonly RunEvent[]) => Promise<void>;
  readonly readRun: (runId: string) => Promise<RunWithSteps | undefined>;
  readonly listRuns: (status: RunStatusName) => Promise<readonly StoredRun[]>;
  readonly readEvents: (runId: string) => Promise<readonly RunEvent[]>;
  readonly acquire: (runId: string, owner: string, now: Date) => Promise<LockResult>;
  readonly heartbeat: (writer: Writer, now: Date) => Promise<void>;
  readonly release: (writer: Writer) => Promise<void>;
};

export type StoredTaskToken = {
  readonly hash: string;
  readonly runId: string;
  readonly stepKey: string;
  readonly round: number;
  readonly issuedAt: string;
};

export type TaskTokenStore = {
  readonly replaceTaskToken: (token: StoredTaskToken) => Promise<void>;
  readonly taskTokens: () => Promise<readonly StoredTaskToken[]>;
  readonly removeTaskTokens: (runId: string) => Promise<void>;
};

export function settledOf(record: StepRecord): Settled | undefined {
  switch (record.status) {
    case "started":
      return undefined;
    case "done":
      return { status: "done", output: record.output };
    case "failed":
      return { status: "failed", reason: record.reason };
  }
}
