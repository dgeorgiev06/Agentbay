import { DatabaseSync } from "node:sqlite";
import type { RunEvent } from "../contracts.ts";
import { databaseLockWaitMilliseconds, isLockedError } from "../database-lock.ts";
import { narrowSideFiles } from "../owner-only.ts";
import type { Folders } from "../ports.ts";
import {
  lockStaleMilliseconds,
  type AnswerRule,
  type LockRequest,
  type LockResult,
  type RecordedAnswer,
  type Recording,
  type NewRun,
  type RunPatch,
  type RunStatusName,
  type RunStore,
  type RunWithSteps,
  type StepChange,
  type StepEnd,
  type StepRecord,
  type StepRefusal,
  type StepStart,
  type StoredRun,
  type Writer,
} from "./run-store.ts";
import { storedText } from "./packed-output.ts";
import {
  answered,
  answerOf,
  eventOf,
  inTransaction,
  integerColumn,
  keepingGiven,
  optionalText,
  runOf,
  stateAssignments,
  stateColumns,
  stepOf,
  storedJson,
  textColumn,
} from "./sqlite-rows.ts";
import { SqliteTaskTokens } from "./sqlite-task-tokens.ts";
import { migrations } from "./kernel-migrations.ts";
import { stepDetailJson } from "./step-detail.ts";

type SqliteOptions = {
  readonly busyMilliseconds?: number;
};

function isStale(heartbeatAt: string, now: Date): boolean {
  return now.getTime() - new Date(heartbeatAt).getTime() > lockStaleMilliseconds;
}

function busyWhenLocked<T>(busy: T): (error: unknown) => T {
  return (error) => {
    if (isLockedError(error)) {
      return busy;
    }
    throw error;
  };
}

export class SqliteRunStore implements RunStore {
  readonly #database: DatabaseSync;
  readonly tokens: SqliteTaskTokens;

  static async open(folders: Folders, file: string): Promise<SqliteRunStore> {
    await folders.ensureOwnerOnlyFile(file);
    return new SqliteRunStore(file);
  }

  constructor(file: string, options: SqliteOptions = {}) {
    this.#database = new DatabaseSync(file, { timeout: options.busyMilliseconds ?? databaseLockWaitMilliseconds });
    this.#database.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.#migrate();
    narrowSideFiles(file);
    this.tokens = new SqliteTaskTokens(this.#database);
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
          `update runs set ${stateAssignments}, extra = ?, spent = ?, stop_reason = ?, updated_at = ?
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

  readonly readRun = (runId: string): Promise<RunWithSteps | undefined> => this.#read(() => this.#runWithSteps(runId));

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
    this.#takeLock(runId, owner, now).catch(busyWhenLocked<LockResult>({ status: "busy" }));

  readonly #takeLock = (runId: string, owner: string, now: Date): Promise<LockResult> =>
    this.#write(() => this.#lockFor(runId, { owner, now }));

  readonly recordAnswer = (answer: RecordedAnswer, lock: LockRequest, rule: AnswerRule): Promise<Recording> =>
    this.#write((): Recording => {
      const allowed = rule(this.#runWithSteps(answer.runId), this.#answeredKeys(answer.runId));
      if (!allowed.ok) {
        return { status: "refused", problems: allowed.problems };
      }
      const keeping = keepingGiven(allowed.value);
      this.#database
        .prepare("insert into answers (run_id, step_key, kept, submission, recorded_at) values (?, ?, ?, ?, ?)")
        .run(answer.runId, answer.stepKey, keeping, storedJson(answer.submission, keeping), answer.at);
      const taken = this.#lockFor(answer.runId, lock);
      return taken.status === "acquired" ? { status: "taken", writer: taken.writer } : { status: "recorded" };
    }).catch(busyWhenLocked<Recording>({ status: "busy" }));

  readonly recordedAnswers = (runId: string): Promise<readonly RecordedAnswer[]> =>
    this.#read(() =>
      this.#database.prepare("select * from answers where run_id = ? order by rowid").all(runId).map(answerOf),
    );

  readonly forgetAnswer = (writer: Writer, stepKey: string, events: readonly RunEvent[]): Promise<void> =>
    this.#write(() => {
      this.#checkOwner(writer);
      this.#database.prepare("delete from answers where run_id = ? and step_key = ?").run(writer.runId, stepKey);
      this.#insertEvents(events);
    });

  readonly heartbeat = (writer: Writer, now: Date): Promise<void> =>
    this.#write(() => {
      this.#claim(writer, now.toISOString());
    });

  readonly release = (writer: Writer): Promise<void> =>
    this.#write(() => {
      this.#unlock(writer);
    });

  readonly releaseUnlessAnswered = (writer: Writer): Promise<boolean> =>
    this.#write(() => {
      if (this.#answeredKeys(writer.runId).size > 0 && this.#holds(writer)) {
        return false;
      }
      this.#unlock(writer);
      return true;
    });

  #unlock(writer: Writer): void {
    this.#database
      .prepare("update runs set lock_owner = null, lock_heartbeat = null where id = ? and lock_owner = ?")
      .run(writer.runId, writer.owner);
  }

  #lockFor(runId: string, lock: LockRequest): LockResult {
    const { owner, now } = lock;
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
  }

  #runWithSteps(runId: string): RunWithSteps | undefined {
    const row = this.#database.prepare("select * from runs where id = ?").get(runId);
    if (row === undefined) {
      return undefined;
    }
    const steps = this.#database.prepare("select * from steps where run_id = ? order by rowid").all(runId);
    return { ...runOf(row), steps: steps.map(stepOf) };
  }

  #answeredKeys(runId: string): ReadonlySet<string> {
    const rows = this.#database.prepare("select step_key from answers where run_id = ?").all(runId);
    return new Set(rows.map((row) => textColumn(row, "step_key")));
  }

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
    return inTransaction(this.#database, body);
  }

  #write<T>(body: () => T): Promise<T> {
    return answered(() => this.#transaction(body));
  }

  #read<T>(body: () => T): Promise<T> {
    return answered(body);
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

  #holderOf(runId: string): string | undefined {
    const row = this.#database.prepare("select lock_owner from runs where id = ?").get(runId);
    return row === undefined ? undefined : optionalText(row, "lock_owner");
  }

  #holds(writer: Writer): boolean {
    return this.#holderOf(writer.runId) === writer.owner;
  }

  #checkOwner(writer: Writer): void {
    const holder = this.#holderOf(writer.runId);
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
