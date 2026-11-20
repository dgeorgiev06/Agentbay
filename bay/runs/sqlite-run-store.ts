import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { budgetFromJson, spendFromJson } from "./budget.ts";
import type { Json, RunEvent, Spend } from "../contracts.ts";
import { databaseLockWaitMilliseconds, isLockedError } from "../database-lock.ts";
import { parseJson } from "../json.ts";
import { narrowSideFiles } from "../owner-only.ts";
import type { Folders } from "../ports.ts";
import {
  lockStaleMilliseconds,
  runStatuses,
  waitingReasons,
  type LockResult,
  type NewRun,
  type RunPatch,
  type RunStatusName,
  type RunStore,
  type RunTarget,
  type RunWithSteps,
  type StepChange,
  type StepEnd,
  type StepRecord,
  type StepRefusal,
  type StepStart,
  type StoredRun,
  type StoredState,
  type StoredTaskToken,
  type TaskTokenStore,
  type Writer,
} from "./run-store.ts";
import { keepings, storedText, unpackedText } from "./packed-output.ts";
import type { Keeping } from "../generated/mode.ts";
import { decodedStepDetail, stepDetailJson, stepKinds } from "./step-detail.ts";

type SqliteOptions = {
  readonly busyMilliseconds?: number;
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
    status text not null check (status in ('started', 'done', 'failed')),
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
  "alter table runs add column target_caller text;",
  `alter table runs add column kept text not null default 'as-text' check (kept in ('as-text', 'kept-packed'));
  alter table steps add column kept text not null default 'as-text' check (kept in ('as-text', 'kept-packed'));`,
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

function keptTextColumn(row: Row, name: string, keeping: Keeping): string {
  return unpackedText(textColumn(row, name), keeping);
}

function keptJsonColumn(row: Row, name: string, keeping: Keeping): Json {
  return parseJson(keptTextColumn(row, name, keeping));
}

function storedJson(value: Json, keeping: Keeping): string {
  return storedText(JSON.stringify(value), keeping);
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
  const target = { kind, mode: textColumn(row, "target_mode"), name: textColumn(row, "target_name") };
  const caller = optionalText(row, "target_caller");
  return kind === "action" && caller !== undefined ? { ...target, kind, caller } : target;
}

function waitingStateOf(row: Row): StoredState {
  const reason = literalOf(waitingReasons, textColumn(row, "waiting_reason"));
  const stepKey = textColumn(row, "waiting_step");
  const until = optionalText(row, "waiting_until");
  return { status: "waiting", reason, stepKey, ...(until === undefined ? {} : { until }) };
}

function keepingOf(row: Row): Keeping {
  return literalOf(keepings, textColumn(row, "kept"));
}

function keepingGiven(kept: { readonly kept?: Keeping }): Keeping {
  return kept.kept ?? "as-text";
}

function keptField(keeping: Keeping): { readonly kept?: Keeping } {
  return keeping === "as-text" ? {} : { kept: keeping };
}

function stateOf(row: Row): StoredState {
  const status = literalOf(runStatuses, textColumn(row, "status"));
  const keeping = keepingOf(row);
  switch (status) {
    case "running":
      return { status };
    case "waiting":
      return waitingStateOf(row);
    case "done":
      return { status, output: keptJsonColumn(row, "output", keeping) };
    case "failed":
      return { status, reason: textColumn(row, "reason") };
    case "undone":
      return { status, reason: textColumn(row, "reason"), undo: keptJsonColumn(row, "output", keeping) };
  }
}

function runOf(row: Row): StoredRun {
  return {
    id: textColumn(row, "id"),
    target: targetOf(row),
    ...keptField(keepingOf(row)),
    input: keptJsonColumn(row, "input", keepingOf(row)),
    state: stateOf(row),
    limit: budgetFromJson(jsonColumn(row, "limits")),
    extra: budgetFromJson(jsonColumn(row, "extra")),
    spent: spendFromJson(jsonColumn(row, "spent")),
    stopReason: optionalText(row, "stop_reason"),
    createdAt: textColumn(row, "created_at"),
    updatedAt: textColumn(row, "updated_at"),
  };
}

const storedStepStatuses = ["started", "done", "failed"] as const;

function stepEndOf(row: Row): { readonly spent: Spend; readonly finishOrder: number; readonly finishedAt: string } {
  return {
    spent: spendFromJson(jsonColumn(row, "spent")),
    finishOrder: integerColumn(row, "finish_order"),
    finishedAt: textColumn(row, "finished_at"),
  };
}

function stepOf(row: Row): StepRecord {
  const kept = keepingOf(row);
  const start = {
    key: textColumn(row, "key"),
    input: keptJsonColumn(row, "input", kept),
    startedAt: textColumn(row, "started_at"),
    ...keptField(kept),
  };
  const kind = literalOf(stepKinds, textColumn(row, "kind"));
  const detail = keptJsonColumn(row, "detail", kept);
  const status = literalOf(storedStepStatuses, textColumn(row, "status"));
  if (status === "failed" && detail === null) {
    return { ...start, kind, detail, ...stepEndOf(row), status, reason: keptTextColumn(row, "reason", kept) };
  }
  const typed = decodedStepDetail(kind, detail);
  switch (status) {
    case "started":
      return { ...start, ...typed, status };
    case "done":
      return { ...start, ...typed, ...stepEndOf(row), status, output: keptJsonColumn(row, "output", kept) };
    case "failed":
      return { ...start, ...typed, ...stepEndOf(row), status, reason: keptTextColumn(row, "reason", kept) };
  }
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

function stateColumns(state: StoredState, keeping: Keeping): readonly SQLInputValue[] {
  switch (state.status) {
    case "running":
      return [state.status, null, null, null, null, null];
    case "waiting":
      return [state.status, state.reason, state.stepKey, state.until ?? null, null, null];
    case "done":
      return [state.status, null, null, null, storedJson(state.output, keeping), null];
    case "failed":
      return [state.status, null, null, null, null, state.reason];
    case "undone":
      return [state.status, null, null, null, storedJson(state.undo, keeping), state.reason];
  }
}

function isStale(heartbeatAt: string, now: Date): boolean {
  return now.getTime() - new Date(heartbeatAt).getTime() > lockStaleMilliseconds;
}

export class SqliteRunStore implements RunStore, TaskTokenStore {
  readonly #database: DatabaseSync;

  static async open(folders: Folders, file: string): Promise<SqliteRunStore> {
    await folders.ensureOwnerOnlyFile(file);
    return new SqliteRunStore(file);
  }

  constructor(file: string, options: SqliteOptions = {}) {
    this.#database = new DatabaseSync(file, { timeout: options.busyMilliseconds ?? databaseLockWaitMilliseconds });
    this.#database.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.#migrate();
    narrowSideFiles(file);
  }

  close(): void {
    this.#database.close();
  }

  readonly createRun = (run: NewRun, owner: string, events: readonly RunEvent[]): Promise<Writer> =>
    this.#write(() => {
      this.#database
        .prepare(
          `insert into runs (id, target_kind, target_mode, target_name, target_caller, kept, input, status, limits,
            extra, spent, lock_owner, lock_heartbeat, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, 'running', ?, '{}', ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.target.kind,
          run.target.mode,
          run.target.name,
          run.target.kind === "action" ? (run.target.caller ?? null) : null,
          keepingGiven(run),
          storedJson(run.input, keepingGiven(run)),
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
          `insert into steps (run_id, key, kind, status, kept, input, detail, spent, started_at)
           values (?, ?, ?, 'started', ?, ?, ?, '{}', ?)`,
        )
        .run(
          writer.runId,
          start.key,
          start.kind,
          keepingGiven(start),
          storedJson(start.input, keepingGiven(start)),
          storedJson(stepDetailJson(start), keepingGiven(start)),
          start.at,
        );
      this.#touch(writer.runId, start.at);
      this.#insertEvents(events);
      return this.#step(writer.runId, start.key);
    });

  readonly saveStepOutput = (writer: Writer, end: StepEnd, events: readonly RunEvent[]): Promise<StepRecord> =>
    this.#write(() => {
      this.#claim(writer, end.at);
      const started = this.#checkStarted(writer.runId, end.key);
      const keeping = keepingGiven(started);
      const output = end.status === "done" ? storedJson(end.output, keeping) : null;
      const reason = end.status === "failed" ? storedText(end.reason, keeping) : null;
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

  readonly saveStepDetail = (writer: Writer, change: StepChange, events: readonly RunEvent[]): Promise<StepRecord> =>
    this.#write(() => {
      this.#claim(writer, change.at);
      const step = this.#checkStarted(writer.runId, change.key);
      if (step.kind !== change.kind) {
        throw new Error(`Step ${change.key} of run ${writer.runId} is a ${step.kind} step, not a ${change.kind} step.`);
      }
      this.#database
        .prepare("update steps set detail = ? where run_id = ? and key = ?")
        .run(storedJson(stepDetailJson(change), keepingGiven(step)), writer.runId, change.key);
      this.#touch(writer.runId, change.at);
      this.#insertEvents(events);
      return this.#step(writer.runId, change.key);
    });

  readonly saveRefusal = (writer: Writer, refusal: StepRefusal, events: readonly RunEvent[]): Promise<StepRecord> =>
    this.#write(() => {
      this.#claim(writer, refusal.at);
      const keeping = keepingGiven(refusal);
      this.#database
        .prepare(
          `insert into steps (run_id, key, kind, status, kept, input, reason, detail, spent, finish_order, started_at,
            finished_at)
           values (?, ?, ?, 'failed', ?, ?, ?, ?, ?,
            (select coalesce(max(finish_order), 0) + 1 from steps where run_id = ?), ?, ?)`,
        )
        .run(
          writer.runId,
          refusal.key,
          refusal.kind,
          keeping,
          storedJson(refusal.input, keeping),
          storedText(refusal.reason, keeping),
          storedJson(null, keeping),
          JSON.stringify({ items: 0, usd: 0, tokens: 0, minutes: 0 }),
          writer.runId,
          refusal.at,
          refusal.at,
        );
      this.#touch(writer.runId, refusal.at);
      this.#insertEvents(events);
      return this.#step(writer.runId, refusal.key);
    });

  readonly updateRun = (writer: Writer, patch: RunPatch, events: readonly RunEvent[]): Promise<void> =>
    this.#write(() => {
      this.#claim(writer, patch.at);
      const current = this.#run(writer.runId);
      const state = stateColumns(patch.state ?? current.state, keepingGiven(current));
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

  readonly readRun = (runId: string): Promise<RunWithSteps | undefined> =>
    this.#read(() => {
      const row = this.#database.prepare("select * from runs where id = ?").get(runId);
      if (row === undefined) {
        return undefined;
      }
      const steps = this.#database.prepare("select * from steps where run_id = ? order by rowid").all(runId);
      return { ...runOf(row), steps: steps.map(stepOf) };
    });

  readonly listRuns = (status: RunStatusName): Promise<readonly StoredRun[]> =>
    this.#read(() =>
      this.#database.prepare("select * from runs where status = ? order by created_at, id").all(status).map(runOf),
    );

  readonly readEvents = (runId: string): Promise<readonly RunEvent[]> =>
    this.#read(() =>
      this.#database.prepare("select * from events where run_id = ? order by id").all(runId).map(eventOf),
    );

  readonly append = (event: RunEvent): Promise<void> =>
    this.#write(() => {
      this.#insertEvents([event]);
    });

  readonly acquire = (runId: string, owner: string, now: Date): Promise<LockResult> =>
    this.#takeLock(runId, owner, now).catch((error: unknown): LockResult => {
      if (isLockedError(error)) {
        return { status: "busy" };
      }
      throw error;
    });

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

  readonly taskTokens = (): Promise<readonly StoredTaskToken[]> =>
    this.#read(() =>
      this.#database.prepare("select * from task_tokens order by issued_at, run_id").all().map(taskTokenOf),
    );

  readonly removeTaskTokens = (runId: string): Promise<void> =>
    this.#write(() => {
      this.#database.prepare("delete from task_tokens where run_id = ?").run(runId);
    });

  #migrate(): void {
    if (this.#version() >= migrations.length) {
      return;
    }
    this.#transaction(() => {
      const version = this.#version();
      for (const [index, migration] of migrations.entries()) {
        if (index >= version) {
          this.#database.exec(migration);
          this.#database.exec(`pragma user_version = ${String(index + 1)}`);
        }
      }
    });
  }

  #version(): number {
    const row = this.#database.prepare("pragma user_version").get();
    return row === undefined ? 0 : integerColumn(row, "user_version");
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
    return this.#read(() => this.#transaction(body));
  }

  #read<T>(body: () => T): Promise<T> {
    return new Promise((resolve) => {
      resolve(body());
    });
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

  #checkStarted(runId: string, key: string): StepRecord {
    const step = this.#step(runId, key);
    if (step.status !== "started") {
      throw new Error(`Step ${key} of run ${runId} is already ${step.status}.`);
    }
    return step;
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
