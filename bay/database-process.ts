import { fileURLToPath } from "node:url";
import { errorLine } from "./answers.ts";
import type { Child, ChildEnd, ChildProcesses } from "./ports.ts";
import type { Json } from "./contracts.ts";
import type { DatabaseResult, Migration, SqlParameters } from "./database.ts";
import { isJsonRecord, parsedLine } from "./protocol-json.ts";

export type DatabaseOrder =
  | { readonly method: "query"; readonly sql: string; readonly parameters: SqlParameters }
  | { readonly method: "execute"; readonly sql: string; readonly parameters: SqlParameters; readonly writable: boolean }
  | { readonly method: "migrate"; readonly migrations: readonly Migration[]; readonly appliedAt: string };

export type DatabaseProcessOptions = {
  readonly childProcesses: ChildProcesses;
  readonly databaseFile: string;
  readonly lifetimeMilliseconds: number;
};

const bayFolder = fileURLToPath(new URL(".", import.meta.url));

const childFile = `${bayFolder}database-child.ts`;

const replyBytes = 256 * 1024 * 1024;

const statuses: readonly string[] = ["done", "missing", "writes-on-read-only", "several-statements", "error"];

function resultOf(value: Json | undefined): DatabaseResult<Json> | undefined {
  if (!isJsonRecord(value) || typeof value.status !== "string" || !statuses.includes(value.status)) {
    return undefined;
  }
  switch (value.status) {
    case "done":
      return value.value === undefined ? undefined : { status: "done", value: value.value };
    case "error":
      return typeof value.message === "string" ? { status: "error", message: value.message } : undefined;
    case "missing":
      return { status: "missing" };
    case "writes-on-read-only":
      return { status: "writes-on-read-only" };
    default:
      return { status: "several-statements" };
  }
}

function stopped(end: ChildEnd): DatabaseResult<never> {
  return {
    status: "error",
    message: `The database process stopped (${end.how}) before it answered. ${end.errorOutput}`,
  };
}

type Waiting = {
  readonly child: Child;
  readonly resolve: (result: DatabaseResult<Json>) => void;
};

export class DatabaseProcess {
  readonly #options: DatabaseProcessOptions;
  readonly #waiting = new Map<number, Waiting>();
  #child: Child | undefined;
  #nextId = 1;

  constructor(options: DatabaseProcessOptions) {
    this.#options = options;
  }

  request(order: DatabaseOrder): Promise<DatabaseResult<Json>> {
    const child = this.#child ?? this.#start();
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve) => {
      this.#waiting.set(id, { child, resolve });
      child.send(JSON.stringify({ id, ...order }));
    });
  }

  close(): void {
    this.#child?.kill();
    this.#child = undefined;
  }

  #start(): Child {
    const child = this.#options.childProcesses.start(
      {
        command: process.execPath,
        arguments: ["--disable-warning=ExperimentalWarning", childFile, this.#options.databaseFile],
        directory: "/",
        environment: {},
        timeoutMilliseconds: this.#options.lifetimeMilliseconds,
        maximumOutputBytes: replyBytes,
      },
      (line) => {
        this.#received(line);
      },
    );
    this.#child = child;
    child.ended.then(
      (end) => {
        this.#ended(child, stopped(end));
      },
      (error: unknown) => {
        this.#ended(child, {
          status: "error",
          message: `The database process could not be watched: ${errorLine(error)}`,
        });
      },
    );
    return child;
  }

  #ended(child: Child, result: DatabaseResult<never>): void {
    if (this.#child === child) {
      this.#child = undefined;
    }
    for (const [id, waiting] of this.#waiting) {
      if (waiting.child === child) {
        this.#waiting.delete(id);
        waiting.resolve(result);
      }
    }
  }

  #received(line: string): void {
    const reply = parsedLine(line);
    if (!isJsonRecord(reply) || typeof reply.id !== "number") {
      return;
    }
    const waiting = this.#waiting.get(reply.id);
    this.#waiting.delete(reply.id);
    waiting?.resolve(
      resultOf(reply.result) ?? { status: "error", message: "The database process sent a malformed reply." },
    );
  }
}
