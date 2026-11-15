import { noSpend } from "../bay/budget.ts";
import type { RunEvent } from "../bay/contracts.ts";
import {
  lockStaleMilliseconds,
  type LockResult,
  type NewRun,
  type RunPatch,
  type RunStatusName,
  type RunStore,
  type RunWithSteps,
  type StepDetail,
  type StepEnd,
  type StepRecord,
  type StepStart,
  type StoredRun,
  type Writer,
} from "../bay/run-store.ts";

type Lock = {
  readonly owner: string;
  readonly heartbeatAt: string;
};

type Entry = {
  run: StoredRun;
  readonly steps: Map<string, StepRecord>;
  lock: Lock | undefined;
};

export class MemoryRunStore implements RunStore {
  readonly #entries = new Map<string, Entry>();
  readonly #events: RunEvent[] = [];
  #finishOrder = 0;

  readonly createRun = (run: NewRun, owner: string, events: readonly RunEvent[]): Promise<Writer> => {
    if (this.#entries.has(run.id)) {
      throw new Error(`The run ${run.id} already exists.`);
    }
    const stored: StoredRun = {
      id: run.id,
      target: run.target,
      input: structuredClone(run.input),
      state: { status: "running" },
      limit: run.limit,
      extra: {},
      spent: noSpend,
      stopReason: undefined,
      createdAt: run.at,
      updatedAt: run.at,
    };
    this.#entries.set(run.id, { run: stored, steps: new Map(), lock: { owner, heartbeatAt: run.at } });
    this.#push(events);
    return Promise.resolve({ runId: run.id, owner });
  };

  readonly saveStepInput = (writer: Writer, start: StepStart, events: readonly RunEvent[]): Promise<StepRecord> => {
    const entry = this.#owned(writer);
    if (entry.steps.has(start.key)) {
      throw new Error(`Step ${start.key} of run ${writer.runId} already exists.`);
    }
    const record: StepRecord = {
      key: start.key,
      kind: start.kind,
      input: structuredClone(start.input),
      detail: structuredClone(start.detail),
      startedAt: start.at,
      status: "started",
    };
    return Promise.resolve(this.#keep(entry, { record, at: start.at, events }));
  };

  readonly saveStepOutput = (writer: Writer, end: StepEnd, events: readonly RunEvent[]): Promise<StepRecord> => {
    const entry = this.#owned(writer);
    const started = this.#started(entry, end.key);
    this.#finishOrder += 1;
    const finished = { spent: end.spent, finishOrder: this.#finishOrder, finishedAt: end.at };
    const record: StepRecord =
      end.status === "finished"
        ? { ...started, ...finished, status: "finished", output: structuredClone(end.output) }
        : { ...started, ...finished, status: "failed", reason: end.reason };
    return Promise.resolve(this.#keep(entry, { record, at: end.at, events }));
  };

  readonly saveStepDetail = (writer: Writer, change: StepDetail, events: readonly RunEvent[]): Promise<StepRecord> => {
    const entry = this.#owned(writer);
    const record: StepRecord = { ...this.#started(entry, change.key), detail: structuredClone(change.detail) };
    return Promise.resolve(this.#keep(entry, { record, at: change.at, events }));
  };

  readonly updateRun = (writer: Writer, patch: RunPatch, events: readonly RunEvent[]): Promise<void> => {
    const entry = this.#owned(writer);
    entry.run = {
      ...entry.run,
      state: structuredClone(patch.state ?? entry.run.state),
      extra: patch.extra ?? entry.run.extra,
      spent: patch.spent ?? entry.run.spent,
      stopReason: patch.stopReason ?? entry.run.stopReason,
      updatedAt: patch.at,
    };
    this.#push(events);
    return Promise.resolve();
  };

  readonly readRun = (runId: string): Promise<RunWithSteps | undefined> => {
    const entry = this.#entries.get(runId);
    if (entry === undefined) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(structuredClone({ ...entry.run, steps: [...entry.steps.values()] }));
  };

  readonly listRuns = (status: RunStatusName): Promise<readonly StoredRun[]> => {
    const runs = [...this.#entries.values()].map((entry) => entry.run).filter((run) => run.state.status === status);
    return Promise.resolve(structuredClone(runs));
  };

  readonly readEvents = (runId: string): Promise<readonly RunEvent[]> =>
    Promise.resolve(structuredClone(this.#events.filter((event) => event.runId === runId)));

  readonly append = (event: RunEvent): Promise<void> => {
    this.#push([event]);
    return Promise.resolve();
  };

  readonly acquire = (runId: string, owner: string, now: Date): Promise<LockResult> => {
    const entry = this.#entries.get(runId);
    if (entry === undefined) {
      return Promise.resolve({ status: "missing" });
    }
    const lock = entry.lock;
    if (lock !== undefined && now.getTime() - new Date(lock.heartbeatAt).getTime() <= lockStaleMilliseconds) {
      return Promise.resolve({ status: "held", owner: lock.owner, heartbeatAt: lock.heartbeatAt });
    }
    entry.lock = { owner, heartbeatAt: now.toISOString() };
    if (lock !== undefined) {
      const detail = { previousOwner: lock.owner, heartbeatAt: lock.heartbeatAt, owner };
      this.#push([{ at: now.toISOString(), runId, kind: "lock.taken-over", detail }]);
    }
    return Promise.resolve({ status: "acquired", writer: { runId, owner } });
  };

  readonly heartbeat = (writer: Writer, now: Date): Promise<void> => {
    this.#owned(writer).lock = { owner: writer.owner, heartbeatAt: now.toISOString() };
    return Promise.resolve();
  };

  readonly release = (writer: Writer): Promise<void> => {
    const entry = this.#entries.get(writer.runId);
    if (entry?.lock?.owner === writer.owner) {
      entry.lock = undefined;
    }
    return Promise.resolve();
  };

  #owned(writer: Writer): Entry {
    const entry = this.#entries.get(writer.runId);
    if (entry === undefined) {
      throw new Error(`There is no run ${writer.runId}.`);
    }
    if (entry.lock?.owner !== writer.owner) {
      throw new Error(`The writer ${writer.owner} no longer holds the lock of run ${writer.runId}.`);
    }
    return entry;
  }

  #started(entry: Entry, key: string): StepRecord & { readonly status: "started" } {
    const record = entry.steps.get(key);
    if (record?.status !== "started") {
      throw new Error(`Step ${key} of run ${entry.run.id} is ${record?.status ?? "missing"}, not started.`);
    }
    return record;
  }

  #keep(entry: Entry, change: { record: StepRecord; at: string; events: readonly RunEvent[] }): StepRecord {
    entry.steps.set(change.record.key, change.record);
    entry.run = { ...entry.run, updatedAt: change.at };
    this.#push(change.events);
    return structuredClone(change.record);
  }

  #push(events: readonly RunEvent[]): void {
    this.#events.push(...events.map((event) => structuredClone(event)));
  }
}
