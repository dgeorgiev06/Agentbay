import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { budgetFromJson, spendFromJson } from "./budget.ts";
import type { EventSink, Json, RunEvent, Spend } from "./contracts.ts";
import type { Budget } from "./generated/mode.ts";
import { parseJson } from "./json.ts";
import type { Folders } from "./ports.ts";

export const kernelDatabaseFile = ".agentbay/kernel.db";

export const lockStaleMilliseconds = 10 * 60 * 1000;

const defaultBusyMilliseconds = 3000;

export const runStatuses = ["running", "waiting", "done", "failed", "undone"] as const;

export type RunStatusName = (typeof runStatuses)[number];

export const waitingReasons = ["skill", "approval", "time", "budget", "owner"] as const;

export type WaitingReason = (typeof waitingReasons)[number];

export const stepKinds = ["script", "check", "skill", "call", "action", "undo", "approval", "wait", "foreach"] as const;

export type StepKind = (typeof stepKinds)[number];

export type RunTarget =
  | { readonly kind: "action"; readonly mode: string; readonly name: string }
  | { readonly kind: "workflow"; readonly mode: string; readonly name: string };

export type StoredState =
  | { readonly status: "running" }
  | { readonly status: "waiting"; readonly reason: WaitingReason; readonly stepKey: string; readonly until?: string }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "undone"; readonly reason: string; readonly undo: Json };

type StepStartFields = {
  readonly key: string;
  readonly kind: StepKind;
  readonly input: Json;
  readonly detail: Json;
  readonly startedAt: string;
};

type StepEndFields = {
  readonly spent: Spend;
  readonly finishOrder: number;
  readonly finishedAt: string;
};

export type StepRecord =
  | (StepStartFields & { readonly status: "started" })
  | (StepStartFields & StepEndFields & { readonly status: "finished"; readonly output: Json })
  | (StepStartFields & StepEndFields & { readonly status: "failed"; readonly reason: string });

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

export type StepStart = {
  readonly key: string;
  readonly kind: StepKind;
  readonly input: Json;
  readonly detail: Json;
  readonly at: string;
};

export type StepEnd =
  | {
      readonly key: string;
      readonly status: "finished";
      readonly output: Json;
      readonly spent: Spend;
      readonly at: string;
    }
  | {
      readonly key: string;
      readonly status: "failed";
      readonly reason: string;
      readonly spent: Spend;
      readonly at: string;
    };

export type StepDetail = {
  readonly key: string;
  readonly detail: Json;
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

export type SqliteOptions = {
  readonly busyMilliseconds?: number;
};

export type RunStore = EventSink & {
  readonly createRun: (run: NewRun, owner: string, events: readonly RunEvent[]) => Promise<Writer>;
  readonly saveStepInput: (writer: Writer, start: StepStart, events: readonly RunEvent[]) => Promise<StepRecord>;
  readonly saveStepOutput: (writer: Writer, end: StepEnd, events: readonly RunEvent[]) => Promise<StepRecord>;
  readonly saveStepDetail: (writer: Writer, change: StepDetail, events: readonly RunEvent[]) => Promise<StepRecord>;
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

type Row = Readonly<Record<string, SQLOutputValue>>;

const migrations: readonly string[] = [
  `create table runs (
    id text primary key,
    target_kind text not null check (target_kind in ('action', 'workflow')),
    target_mode text not null,
    target_name text not null,
    input text not null,
    status text not null check (status in ('running', 'waiting', 'done', 'failed', 'undone')),
    waiting_reason text check (waiting_reason in ('skill', 'approval', 'time', 'budget', 'owner')),
    waiting_step text,
    waiting_until text,
    output text,
    reason text,
    limits text not null,
    extra text not null,
    spent text not null,
    stop_reason text,
    lock_owner text,
    lock_heartbeat text,
    created_at text not null,
    updated_at text not null
  );
  create index runs_by_status on runs (status, created_at);
  create table steps (
    run_id text not null references runs (id),
    key text not null,
    kind text not null,
    status text not null check (status in ('started', 'finished', 'failed')),
    input text not null,
    output text,
    reason text,
    detail text not null,
    spent text not null,
    finish_order integer,
    started_at text not null,
    finished_at text,
    primary key (run_id, key)
  );
  create table events (
    id integer primary key autoincrement,
    run_id text not null,
    at text not null,
    kind text not null,
    detail text not null
  );
  create index events_by_run on events (run_id, id);`,
  `create table task_tokens (
    hash text primary key,
    run_id text not null references runs (id),
    step_key text not null,
    round integer not null,
    issued_at text not null
  );
  create index task_tokens_by_run on task_tokens (run_id);`,
];

function textColumn(row: Row, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new Error(`The column ${name} of kernel.db holds ${typeof value}, not text.`);
  }
  return value;
}

function optionalText(row: Row, name: string): string | undefined {
  return row[name] === null ? undefined : textColumn(row, name);
}

function jsonColumn(row: Row, name: string): Json {
  return parseJson(textColumn(row, name));
}

function integerColumn(row: Row, name: string): number {
  const value = row[name];
  if (typeof value !== "number") {
    throw new Error(`The column ${name} of kernel.db holds ${typeof value}, not a number.`);
  }
  return value;
}

function literalOf<T extends string>(choices: readonly T[], value: string): T {
  const found = choices.find((choice) => choice === value);
  if (found === undefined) {
    throw new Error(`kernel.db holds ${value}, which is not one of ${choices.join(", ")}.`);
  }
  return found;
}

function targetOf(row: Row): RunTarget {
  const kind = literalOf(["action", "workflow"], textColumn(row, "target_kind"));
  return { kind, mode: textColumn(row, "target_mode"), name: textColumn(row, "target_name") };
}

function waitingStateOf(row: Row): StoredState {
  const reason = literalOf(waitingReasons, textColumn(row, "waiting_reason"));
  const stepKey = textColumn(row, "waiting_step");
  const until = optionalText(row, "waiting_until");
  return { status: "waiting", reason, stepKey, ...(until === undefined ? {} : { until }) };
}

function stateOf(row: Row): StoredState {
  const status = literalOf(runStatuses, textColumn(row, "status"));
  switch (status) {
    case "running":
      return { status };
    case "waiting":
      return waitingStateOf(row);
    case "done":
      return { status, output: jsonColumn(row, "output") };
    case "failed":
      return { status, reason: textColumn(row, "reason") };
    case "undone":
      return { status, reason: textColumn(row, "reason"), undo: jsonColumn(row, "output") };
  }
}

function runOf(row: Row): StoredRun {
  return {
    id: textColumn(row, "id"),
    target: targetOf(row),
    input: jsonColumn(row, "input"),
    state: stateOf(row),
    limit: budgetFromJson(jsonColumn(row, "limits")),
    extra: budgetFromJson(jsonColumn(row, "extra")),
    spent: spendFromJson(jsonColumn(row, "spent")),
    stopReason: optionalText(row, "stop_reason"),
    createdAt: textColumn(row, "created_at"),
    updatedAt: textColumn(row, "updated_at"),
  };
}

function stepOf(row: Row): StepRecord {
  const start = {
    key: textColumn(row, "key"),
    kind: literalOf(stepKinds, textColumn(row, "kind")),
    input: jsonColumn(row, "input"),
    detail: jsonColumn(row, "detail"),
    startedAt: textColumn(row, "started_at"),
  };
  const status = literalOf(["started", "finished", "failed"], textColumn(row, "status"));
  if (status === "started") {
    return { ...start, status };
  }
  const end = {
    spent: spendFromJson(jsonColumn(row, "spent")),
    finishOrder: integerColumn(row, "finish_order"),
    finishedAt: textColumn(row, "finished_at"),
  };
  if (status === "finished") {
    return { ...start, ...end, status, output: jsonColumn(row, "output") };
  }
  return { ...start, ...end, status, reason: textColumn(row, "reason") };
}

function eventOf(row: Row): RunEvent {
  return {
    at: textColumn(row, "at"),
    runId: textColumn(row, "run_id"),
    kind: textColumn(row, "kind"),
    detail: jsonColumn(row, "detail"),
  };
}

function taskTokenOf(row: Row): StoredTaskToken {
  return {
    hash: textColumn(row, "hash"),
    runId: textColumn(row, "run_id"),
    stepKey: textColumn(row, "step_key"),
    round: integerColumn(row, "round"),
    issuedAt: textColumn(row, "issued_at"),
  };
}

function stateColumns(state: StoredState): readonly SQLInputValue[] {
  switch (state.status) {
    case "running":
      return [state.status, null, null, null, null, null];
    case "waiting":
      return [state.status, state.reason, state.stepKey, state.until ?? null, null, null];
    case "done":
      return [state.status, null, null, null, JSON.stringify(state.output), null];
    case "failed":
      return [state.status, null, null, null, null, state.reason];
    case "undone":
      return [state.status, null, null, null, JSON.stringify(state.undo), state.reason];
  }
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "errcode" in error ? error.errcode : undefined;
  return code === 5 || code === 6 || /database (table )?is (locked|busy)/.test(error.message);
}

function isStale(heartbeatAt: string, now: Date): boolean {
  return now.getTime() - new Date(heartbeatAt).getTime() > lockStaleMilliseconds;
}

export class SqliteRunStore implements RunStore, TaskTokenStore {
  readonly #database: DatabaseSync;

  static async open(folders: Folders, file: string): Promise<SqliteRunStore> {
    await folders.ensureFolder(dirname(file));
    return new SqliteRunStore(file);
  }

  constructor(file: string, options: SqliteOptions = {}) {
    this.#database = new DatabaseSync(file, { timeout: options.busyMilliseconds ?? defaultBusyMilliseconds });
    this.#database.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.#migrate();
  }

  close(): void {
    this.#database.close();
  }

  readonly createRun = (run: NewRun, owner: string, events: readonly RunEvent[]): Promise<Writer> =>
    this.#write(() => {
      this.#database
        .prepare(
          `insert into runs (id, target_kind, target_mode, target_name, input, status, limits, extra, spent,
            lock_owner, lock_heartbeat, created_at, updated_at)
           values (?, ?, ?, ?, ?, 'running', ?, '{}', ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.target.kind,
          run.target.mode,
          run.target.name,
          JSON.stringify(run.input),
          JSON.stringify(run.limit),
          JSON.stringify({ items: 0, usd: 0, tokens: 0, minutes: 0 }),
          owner,
          run.at,
          run.at,
          run.at,
        );
      this.#insertEvents(events);
      return { runId: run.id, owner };
    });

  readonly saveStepInput = (writer: Writer, start: StepStart, events: readonly RunEvent[]): Promise<StepRecord> =>
    this.#write(() => {
      this.#claim(writer, start.at);
      this.#database
        .prepare(
          `insert into steps (run_id, key, kind, status, input, detail, spent, started_at)
           values (?, ?, ?, 'started', ?, ?, '{}', ?)`,
        )
        .run(writer.runId, start.key, start.kind, JSON.stringify(start.input), JSON.stringify(start.detail), start.at);
      this.#touch(writer.runId, start.at);
      this.#insertEvents(events);
      return this.#step(writer.runId, start.key);
    });

  readonly saveStepOutput = (writer: Writer, end: StepEnd, events: readonly RunEvent[]): Promise<StepRecord> =>
    this.#write(() => {
      this.#claim(writer, end.at);
      this.#checkStarted(writer.runId, end.key);
      const output = end.status === "finished" ? JSON.stringify(end.output) : null;
      const reason = end.status === "failed" ? end.reason : null;
      this.#database
        .prepare(
          `update steps set status = ?, output = ?, reason = ?, spent = ?, finished_at = ?,
            finish_order = (select coalesce(max(finish_order), 0) + 1 from steps where run_id = ?)
           where run_id = ? and key = ?`,
        )
        .run(end.status, output, reason, JSON.stringify(end.spent), end.at, writer.runId, writer.runId, end.key);
      this.#touch(writer.runId, end.at);
      this.#insertEvents(events);
      return this.#step(writer.runId, end.key);
    });

  readonly saveStepDetail = (writer: Writer, change: StepDetail, events: readonly RunEvent[]): Promise<StepRecord> =>
    this.#write(() => {
      this.#claim(writer, change.at);
      this.#checkStarted(writer.runId, change.key);
      this.#database
        .prepare("update steps set detail = ? where run_id = ? and key = ?")
        .run(JSON.stringify(change.detail), writer.runId, change.key);
      this.#touch(writer.runId, change.at);
      this.#insertEvents(events);
      return this.#step(writer.runId, change.key);
    });

  readonly updateRun = (writer: Writer, patch: RunPatch, events: readonly RunEvent[]): Promise<void> =>
    this.#write(() => {
      this.#claim(writer, patch.at);
      const current = this.#run(writer.runId);
      const state = stateColumns(patch.state ?? current.state);
      this.#database
        .prepare(
          `update runs set status = ?, waiting_reason = ?, waiting_step = ?, waiting_until = ?, output = ?, reason = ?,
            extra = ?, spent = ?, stop_reason = ?, updated_at = ?
           where id = ?`,
        )
        .run(
          ...state,
          JSON.stringify(patch.extra ?? current.extra),
          JSON.stringify(patch.spent ?? current.spent),
          patch.stopReason ?? current.stopReason ?? null,
          patch.at,
          writer.runId,
        );
      this.#insertEvents(events);
    });

  readonly readRun = (runId: string): Promise<RunWithSteps | undefined> => {
    const row = this.#database.prepare("select * from runs where id = ?").get(runId);
    if (row === undefined) {
      return Promise.resolve(undefined);
    }
    const steps = this.#database.prepare("select * from steps where run_id = ? order by rowid").all(runId);
    return Promise.resolve({ ...runOf(row), steps: steps.map(stepOf) });
  };

  readonly listRuns = (status: RunStatusName): Promise<readonly StoredRun[]> => {
    const rows = this.#database.prepare("select * from runs where status = ? order by created_at, id").all(status);
    return Promise.resolve(rows.map(runOf));
  };

  readonly readEvents = (runId: string): Promise<readonly RunEvent[]> => {
    const rows = this.#database.prepare("select * from events where run_id = ? order by id").all(runId);
    return Promise.resolve(rows.map(eventOf));
  };

  readonly append = (event: RunEvent): Promise<void> =>
    this.#write(() => {
      this.#insertEvents([event]);
    });

  readonly acquire = (runId: string, owner: string, now: Date): Promise<LockResult> => {
    try {
      return this.#takeLock(runId, owner, now);
    } catch (error) {
      if (isBusy(error)) {
        return Promise.resolve({ status: "busy" });
      }
      throw error;
    }
  };

  readonly #takeLock = (runId: string, owner: string, now: Date): Promise<LockResult> =>
    this.#write((): LockResult => {
      const row = this.#database.prepare("select lock_owner, lock_heartbeat from runs where id = ?").get(runId);
      if (row === undefined) {
        return { status: "missing" };
      }
      const holder = optionalText(row, "lock_owner");
      const heartbeatAt = optionalText(row, "lock_heartbeat") ?? now.toISOString();
      if (holder !== undefined && !isStale(heartbeatAt, now)) {
        return { status: "held", owner: holder, heartbeatAt };
      }
      this.#database
        .prepare("update runs set lock_owner = ?, lock_heartbeat = ? where id = ?")
        .run(owner, now.toISOString(), runId);
      if (holder !== undefined) {
        const detail = { previousOwner: holder, heartbeatAt, owner };
        this.#insertEvents([{ at: now.toISOString(), runId, kind: "lock.taken-over", detail }]);
      }
      return { status: "acquired", writer: { runId, owner } };
    });

  readonly heartbeat = (writer: Writer, now: Date): Promise<void> =>
    this.#write(() => {
      this.#claim(writer, now.toISOString());
    });

  readonly release = (writer: Writer): Promise<void> =>
    this.#write(() => {
      this.#database
        .prepare("update runs set lock_owner = null, lock_heartbeat = null where id = ? and lock_owner = ?")
        .run(writer.runId, writer.owner);
    });

  readonly replaceTaskToken = (token: StoredTaskToken): Promise<void> =>
    this.#write(() => {
      this.#database.prepare("delete from task_tokens where run_id = ?").run(token.runId);
      this.#database
        .prepare("insert into task_tokens (hash, run_id, step_key, round, issued_at) values (?, ?, ?, ?, ?)")
        .run(token.hash, token.runId, token.stepKey, token.round, token.issuedAt);
    });

  readonly taskTokens = (): Promise<readonly StoredTaskToken[]> => {
    const rows = this.#database.prepare("select * from task_tokens order by issued_at, run_id").all();
    return Promise.resolve(rows.map(taskTokenOf));
  };

  readonly removeTaskTokens = (runId: string): Promise<void> =>
    this.#write(() => {
      this.#database.prepare("delete from task_tokens where run_id = ?").run(runId);
    });

  #migrate(): void {
    const row = this.#database.prepare("pragma user_version").get();
    const version = row === undefined ? 0 : integerColumn(row, "user_version");
    for (const [index, migration] of migrations.entries()) {
      if (index < version) {
        continue;
      }
      this.#transaction(() => {
        this.#database.exec(migration);
        this.#database.exec(`pragma user_version = ${String(index + 1)}`);
      });
    }
  }

  #transaction<T>(body: () => T): T {
    this.#database.exec("begin immediate");
    try {
      const result = body();
      this.#database.exec("commit");
      return result;
    } catch (error) {
      this.#database.exec("rollback");
      throw error;
    }
  }

  #write<T>(body: () => T): Promise<T> {
    return Promise.resolve(this.#transaction(body));
  }

  #run(runId: string): StoredRun {
    const row = this.#database.prepare("select * from runs where id = ?").get(runId);
    if (row === undefined) {
      throw new Error(`kernel.db has no run ${runId}.`);
    }
    return runOf(row);
  }

  #step(runId: string, key: string): StepRecord {
    const row = this.#database.prepare("select * from steps where run_id = ? and key = ?").get(runId, key);
    if (row === undefined) {
      throw new Error(`kernel.db has no step ${key} in run ${runId}.`);
    }
    return stepOf(row);
  }

  #claim(writer: Writer, at: string): void {
    this.#checkOwner(writer);
    this.#database.prepare("update runs set lock_heartbeat = ? where id = ?").run(at, writer.runId);
  }

  #checkOwner(writer: Writer): void {
    const row = this.#database.prepare("select lock_owner from runs where id = ?").get(writer.runId);
    const holder = row === undefined ? undefined : optionalText(row, "lock_owner");
    if (holder !== writer.owner) {
      throw new Error(
        `The writer ${writer.owner} no longer holds the lock of run ${writer.runId} ` +
          `(held by ${holder ?? "nobody"}); it must stop writing.`,
      );
    }
  }

  #checkStarted(runId: string, key: string): void {
    const step = this.#step(runId, key);
    if (step.status !== "started") {
      throw new Error(`Step ${key} of run ${runId} has already ${step.status}.`);
    }
  }

  #touch(runId: string, at: string): void {
    this.#database.prepare("update runs set updated_at = ? where id = ?").run(at, runId);
  }

  #insertEvents(events: readonly RunEvent[]): void {
    const insert = this.#database.prepare("insert into events (run_id, at, kind, detail) values (?, ?, ?, ?)");
    for (const event of events) {
      insert.run(event.runId, event.at, event.kind, JSON.stringify(event.detail));
    }
  }
}
