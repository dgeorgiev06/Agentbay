import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { RunStore } from "../../../bay/runs/run-store.ts";
import type { SqliteRunStore } from "../../../bay/runs/sqlite-run-store.ts";

export type KernelDb = {
  readonly file: string;
  readonly remove: () => void;
};

export type FaultPoint = {
  readonly at: number;
  readonly when: "before" | "after";
};

export type FaultyStore = RunStore & {
  readonly writes: readonly string[];
};

type Row = Readonly<Record<string, SQLOutputValue>>;

export type DatabaseRows = Readonly<Record<string, readonly Row[]>>;

const crashMessage = "simulated crash";

const tables = ["runs", "steps", "events", "task_tokens", "answers"];

export function temporaryKernelDb(): KernelDb {
  const folder = mkdtempSync(join(tmpdir(), "agentbay-kernel-db-"));
  mkdirSync(join(folder, ".agentbay"));
  return {
    file: join(folder, ".agentbay", "kernel.db"),
    remove: () => {
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

export function faultInjector(store: SqliteRunStore, point?: FaultPoint): FaultyStore {
  const writes: string[] = [];
  let dead = false;
  const crash = (): never => {
    dead = true;
    throw new Error(crashMessage);
  };
  const write = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    if (dead) {
      throw new Error(crashMessage);
    }
    writes.push(name);
    if (point?.at === writes.length && point.when === "before") {
      crash();
    }
    const result = await operation();
    if (point?.at === writes.length && point.when === "after") {
      crash();
    }
    return result;
  };
  return {
    writes,
    createRun: (run, owner, events) => write("createRun", () => store.createRun(run, owner, events)),
    saveStepInput: (writer, start, events) => write("saveStepInput", () => store.saveStepInput(writer, start, events)),
    saveStepOutput: (writer, end, events) => write("saveStepOutput", () => store.saveStepOutput(writer, end, events)),
    saveStepDetail: (writer, change, events) =>
      write("saveStepDetail", () => store.saveStepDetail(writer, change, events)),
    saveRefusal: (writer, refusal, events) => write("saveRefusal", () => store.saveRefusal(writer, refusal, events)),
    updateRun: (writer, patch, events) => write("updateRun", () => store.updateRun(writer, patch, events)),
    append: (event) => write("append", () => store.append(event)),
    acquire: (runId, owner, now) => write("acquire", () => store.acquire(runId, owner, now)),
    heartbeat: (writer, now) => write("heartbeat", () => store.heartbeat(writer, now)),
    release: (writer) => write("release", () => store.release(writer)),
    releaseUnlessAnswered: (writer) => write("releaseUnlessAnswered", () => store.releaseUnlessAnswered(writer)),
    recordAnswer: (answer, lock, rule) => write("recordAnswer", () => store.recordAnswer(answer, lock, rule)),
    forgetAnswer: (writer, stepKey, events) => write("forgetAnswer", () => store.forgetAnswer(writer, stepKey, events)),
    recordedAnswers: (runId) => store.recordedAnswers(runId),
    readRun: (runId) => store.readRun(runId),
    listRuns: (status) => store.listRuns(status),
    readEvents: (runId) => store.readEvents(runId),
  };
}

export function databaseRows(file: string): DatabaseRows {
  const database = new DatabaseSync(file, { readOnly: true });
  const rows = Object.fromEntries(
    tables.map((table) => [table, database.prepare(`select * from ${table} order by rowid`).all()]),
  );
  database.close();
  return rows;
}
