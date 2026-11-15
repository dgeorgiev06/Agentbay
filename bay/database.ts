import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue, type StatementSync } from "node:sqlite";
import type { Json } from "./contracts.ts";
import { isOneStatement } from "./sql-statements.ts";

export type SqlParameters = readonly Json[] | Readonly<Record<string, Json>>;

export type Row = Readonly<Record<string, Json>>;

export type ExecuteResult = {
  readonly changes: number;
  readonly lastInsertRowid: number;
};

export type Migration = {
  readonly name: string;
  readonly sql: string;
};

export type DatabaseResult<T> =
  | { readonly status: "done"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: "writes-on-read-only" }
  | { readonly status: "several-statements" }
  | { readonly status: "error"; readonly message: string };

export type Connection = "writable" | "read-only";

const sqliteReadOnlyCode = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isReadOnlyError(error: unknown): boolean {
  return error instanceof Error && "errcode" in error && error.errcode === sqliteReadOnlyCode;
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

  constructor(file: string) {
    this.#file = file;
  }

  query(sql: string, parameters: SqlParameters): DatabaseResult<readonly Row[]> {
    return this.#prepared({ sql, parameters, connection: "read-only" }, (bound) => bound.all());
  }

  execute(sql: string, parameters: SqlParameters, connection: Connection): DatabaseResult<ExecuteResult> {
    return this.#prepared({ sql, parameters, connection }, (bound) => bound.run());
  }

  applyMigrations(migrations: readonly Migration[], appliedAt: string): DatabaseResult<readonly string[]> {
    const database = this.#open("writable");
    if (database === undefined) {
      return { status: "missing" };
    }
    database.exec("create table if not exists _migrations (name text primary key, applied_at text not null)");
    const applied = new Set(
      database
        .prepare("select name from _migrations")
        .all()
        .map((row) => String(row.name)),
    );
    const pending = migrations.filter((migration) => !applied.has(migration.name));
    const record = database.prepare("insert into _migrations (name, applied_at) values (?, ?)");
    database.exec("begin");
    for (const migration of pending) {
      try {
        database.exec(migration.sql);
        record.run(migration.name, appliedAt);
      } catch (error) {
        database.exec("rollback");
        return { status: "error", message: `${migration.name}: ${errorMessage(error)}` };
      }
    }
    database.exec("commit");
    return { status: "done", value: pending.map((migration) => migration.name) };
  }

  close(): void {
    this.#writable?.close();
    this.#readOnly?.close();
    this.#writable = undefined;
    this.#readOnly = undefined;
  }

  #open(connection: Connection): DatabaseSync | undefined {
    if (connection === "writable") {
      if (this.#writable === undefined) {
        mkdirSync(dirname(this.#file), { recursive: true });
        this.#writable = new DatabaseSync(this.#file);
        this.#writable.exec("pragma journal_mode = wal");
      }
      return this.#writable;
    }
    if (this.#readOnly === undefined) {
      if (!existsSync(this.#file)) {
        return undefined;
      }
      this.#readOnly = new DatabaseSync(this.#file, { readOnly: true });
      this.#readOnly.exec("pragma query_only = on");
    }
    return this.#readOnly;
  }

  #prepared<T>(statement: Statement, use: (bound: Bound) => T): DatabaseResult<T> {
    const database = this.#open(statement.connection);
    if (database === undefined) {
      return this.#classifiedWithoutFile(statement.sql);
    }
    const bound = bindings(statement.parameters);
    if (typeof bound === "string") {
      return { status: "error", message: bound };
    }
    try {
      const prepared = database.prepare(statement.sql);
      if (!isOneStatement(statement.sql, prepared.sourceSQL)) {
        return { status: "several-statements" };
      }
      return { status: "done", value: use(bind(prepared, bound)) };
    } catch (error) {
      if (isReadOnlyError(error)) {
        return { status: "writes-on-read-only" };
      }
      return { status: "error", message: errorMessage(error) };
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
