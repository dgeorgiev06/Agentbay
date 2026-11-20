import { existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from "node:sqlite";
import type { Json } from "../contracts.ts";
import { databaseLockWaitMilliseconds, isLockedError } from "../database-lock.ts";
import { createOwnerOnlyFile, narrowSideFiles } from "../owner-only.ts";
import type { ExecuteResult, Row, SqlParameters } from "../sdk.ts";
import { isOneStatement } from "./sql-statements.ts";

export type Migration = {
  readonly name: string;
  readonly sql: string;
};

export type DatabaseResult<T> =
  | { readonly status: "done"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: "writes-on-read-only" }
  | { readonly status: "several-statements" }
  | { readonly status: "busy" }
  | { readonly status: "error"; readonly message: string };

export type Connection = "writable" | "read-only";

const sqliteReadOnlyCode = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReadOnlyError(error: unknown): boolean {
  return error instanceof Error && "errcode" in error && error.errcode === sqliteReadOnlyCode;
}

function failureOf(error: unknown): DatabaseResult<never> {
  if (isLockedError(error)) {
    return { status: "busy" };
  }
  if (isReadOnlyError(error)) {
    return { status: "writes-on-read-only" };
  }
  return { status: "error", message: errorMessage(error) };
}

function attempted<T>(work: () => T): DatabaseResult<T> {
  try {
    return { status: "done", value: work() };
  } catch (error) {
    return failureOf(error);
  }
}

function executed(database: DatabaseSync, sql: string): DatabaseResult<null> {
  return attempted(() => {
    database.exec(sql);
    return null;
  });
}

function connected(file: string, readOnly: boolean, setting: string): DatabaseSync {
  const database = new DatabaseSync(file, { readOnly, timeout: databaseLockWaitMilliseconds });
  try {
    database.exec(setting);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function writableConnection(file: string): DatabaseSync {
  createOwnerOnlyFile(file);
  return connected(file, false, "pragma journal_mode = wal");
}

function pendingOf(database: DatabaseSync, migrations: readonly Migration[]): readonly Migration[] {
  database.exec("create table if not exists _migrations (name text primary key, applied_at text not null)");
  const applied = new Set(
    database
      .prepare("select name from _migrations")
      .all()
      .map((row) => String(row.name)),
  );
  return migrations.filter((migration) => !applied.has(migration.name));
}

function appliedNow(
  database: DatabaseSync,
  migrations: readonly Migration[],
  appliedAt: string,
): DatabaseResult<readonly string[]> {
  const pending = attempted(() => pendingOf(database, migrations));
  if (pending.status !== "done") {
    return pending;
  }
  const record = database.prepare("insert into _migrations (name, applied_at) values (?, ?)");
  for (const migration of pending.value) {
    const ran = attempted(() => {
      database.exec(migration.sql);
      record.run(migration.name, appliedAt);
    });
    if (ran.status === "error") {
      return { status: "error", message: `${migration.name}: ${ran.message}` };
    }
    if (ran.status !== "done") {
      return ran;
    }
  }
  return { status: "done", value: pending.value.map((migration) => migration.name) };
}

function migratedInOneTransaction(
  database: DatabaseSync,
  migrations: readonly Migration[],
  appliedAt: string,
): DatabaseResult<readonly string[]> {
  const begun = executed(database, "begin immediate");
  if (begun.status !== "done") {
    return begun;
  }
  const applied = appliedNow(database, migrations, appliedAt);
  const ended = executed(database, applied.status === "done" ? "commit" : "rollback");
  return ended.status === "done" ? applied : ended;
}

function inputValue(value: Json): SQLInputValue | undefined {
  if (value === null || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return undefined;
}

type Bindings =
  | { readonly kind: "positional"; readonly values: readonly SQLInputValue[] }
  | { readonly kind: "named"; readonly values: Readonly<Record<string, SQLInputValue>> };

type Statement = {
  readonly sql: string;
  readonly parameters: SqlParameters;
  readonly connection: Connection;
};

function isList(parameters: SqlParameters): parameters is readonly Json[] {
  return Array.isArray(parameters);
}

function unbindable(name: string): string {
  return `The parameter ${name} is a list or mapping; only text, numbers, true, false and null can be bound.`;
}

function bindings(parameters: SqlParameters): Bindings | string {
  if (isList(parameters)) {
    const values: SQLInputValue[] = [];
    for (const [index, parameter] of parameters.entries()) {
      const value = inputValue(parameter);
      if (value === undefined) {
        return unbindable(String(index + 1));
      }
      values.push(value);
    }
    return { kind: "positional", values };
  }
  const values: Record<string, SQLInputValue> = {};
  for (const [name, parameter] of Object.entries(parameters)) {
    const value = inputValue(parameter);
    if (value === undefined) {
      return unbindable(name);
    }
    values[name] = value;
  }
  return { kind: "named", values };
}

function outputValue(value: SQLOutputValue): Json {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Uint8Array) {
    return `<blob ${String(value.byteLength)} bytes>`;
  }
  return value;
}

function rowOf(row: Readonly<Record<string, SQLOutputValue>>): Row {
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, outputValue(value)]));
}

type Bound = {
  readonly all: () => readonly Row[];
  readonly run: () => ExecuteResult;
};

function bind(statement: StatementSync, bound: Bindings): Bound {
  const all = (): readonly Readonly<Record<string, SQLOutputValue>>[] =>
    bound.kind === "positional" ? statement.all(...bound.values) : statement.all(bound.values);
  const run = (): ExecuteResult => {
    const result = bound.kind === "positional" ? statement.run(...bound.values) : statement.run(bound.values);
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  };
  return { all: () => all().map(rowOf), run };
}

export class ModeDatabase {
  readonly #file: string;
  #writable: DatabaseSync | undefined;
  #readOnly: DatabaseSync | undefined;
  #sideFilesNarrowed = false;

  constructor(file: string) {
    this.#file = file;
  }

  query(sql: string, parameters: SqlParameters): DatabaseResult<readonly Row[]> {
    return this.#prepared({ sql, parameters, connection: "read-only" }, (bound) => bound.all());
  }

  execute(sql: string, parameters: SqlParameters, connection: Connection): DatabaseResult<ExecuteResult> {
    const result = this.#prepared({ sql, parameters, connection }, (bound) => bound.run());
    this.#narrowSideFiles();
    return result;
  }

  applyMigrations(migrations: readonly Migration[], appliedAt: string): DatabaseResult<readonly string[]> {
    const database = this.#writableConnection();
    if (database.status !== "done") {
      return database;
    }
    try {
      return migratedInOneTransaction(database.value, migrations, appliedAt);
    } finally {
      this.#narrowSideFiles();
    }
  }

  close(): void {
    this.#writable?.close();
    this.#readOnly?.close();
    this.#writable = undefined;
    this.#readOnly = undefined;
  }

  #writableConnection(): DatabaseResult<DatabaseSync> {
    if (this.#writable === undefined) {
      const opened = attempted(() => writableConnection(this.#file));
      if (opened.status !== "done") {
        return opened;
      }
      this.#writable = opened.value;
    }
    return { status: "done", value: this.#writable };
  }

  #readOnlyConnection(): DatabaseResult<DatabaseSync> {
    if (this.#readOnly === undefined) {
      if (!existsSync(this.#file)) {
        return { status: "missing" };
      }
      const opened = attempted(() => connected(this.#file, true, "pragma query_only = on"));
      if (opened.status !== "done") {
        return opened;
      }
      this.#readOnly = opened.value;
    }
    return { status: "done", value: this.#readOnly };
  }

  #connection(connection: Connection): DatabaseResult<DatabaseSync> {
    return connection === "writable" ? this.#writableConnection() : this.#readOnlyConnection();
  }

  #narrowSideFiles(): void {
    if (!this.#sideFilesNarrowed && this.#writable !== undefined) {
      narrowSideFiles(this.#file);
      this.#sideFilesNarrowed = true;
    }
  }

  #prepared<T>(statement: Statement, use: (bound: Bound) => T): DatabaseResult<T> {
    const database = this.#connection(statement.connection);
    if (database.status === "missing") {
      return this.#classifiedWithoutFile(statement.sql);
    }
    if (database.status !== "done") {
      return database;
    }
    const bound = bindings(statement.parameters);
    if (typeof bound === "string") {
      return { status: "error", message: bound };
    }
    try {
      const prepared = database.value.prepare(statement.sql);
      if (!isOneStatement(statement.sql, prepared.sourceSQL)) {
        return { status: "several-statements" };
      }
      return { status: "done", value: use(bind(prepared, bound)) };
    } catch (error) {
      return failureOf(error);
    }
  }

  #classifiedWithoutFile(sql: string): DatabaseResult<never> {
    const empty = new DatabaseSync(":memory:");
    try {
      empty.exec("pragma query_only = on");
      empty.prepare(sql).run();
      return { status: "missing" };
    } catch (error) {
      return isReadOnlyError(error) ? { status: "writes-on-read-only" } : { status: "missing" };
    } finally {
      empty.close();
    }
  }
}
