import type { DatabaseSync, SQLInputValue, SQLOutputValue } from "node:sqlite";
import { budgetFromJson, spendFromJson } from "./budget.ts";
import type { Json, RunEvent, Spend } from "../contracts.ts";
import { parseJson, textField, toJson } from "../json.ts";
import {
  runStatuses,
  waitingReasons,
  type RunTarget,
  type StepRecord,
  type StoredRun,
  type StoredState,
  type StoredWait,
  type StoredTaskToken,
  type RecordedAnswer,
} from "./run-store.ts";
import { keepings, storedText, unpackedText } from "./packed-output.ts";
import type { Keeping } from "../generated/mode.ts";
import { decodedStepDetail, stepKinds, submissionFrom } from "./step-detail.ts";

type Row = Readonly<Record<string, SQLOutputValue>>;

export function textColumn(row: Row, name: string): string {
  const value = row[name];
  if (typeof value !== "string") {
    throw new Error(`The column ${name} of kernel.db holds ${typeof value}, not text.`);
  }
  return value;
}

export function optionalText(row: Row, name: string): string | undefined {
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

export function storedJson(value: Json, keeping: Keeping): string {
  return storedText(JSON.stringify(value), keeping);
}

export function integerColumn(row: Row, name: string): number {
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

function storedWaitOf(value: Json): StoredWait {
  const until = textField(value, "until");
  return {
    reason: literalOf(waitingReasons, textField(value, "reason") ?? ""),
    stepKey: textField(value, "stepKey") ?? "",
    ...(until === undefined ? {} : { until }),
  };
}

function alsoWaitingOf(row: Row): { readonly also?: readonly StoredWait[] } {
  const also = row["waiting_also"] === null ? [] : jsonColumn(row, "waiting_also");
  const waits = Array.isArray(also) ? also.map((wait: unknown) => storedWaitOf(toJson(wait))) : [];
  return waits.length === 0 ? {} : { also: waits };
}

function waitingStateOf(row: Row): StoredState {
  const reason = literalOf(waitingReasons, textColumn(row, "waiting_reason"));
  const stepKey = textColumn(row, "waiting_step");
  const until = optionalText(row, "waiting_until");
  return { status: "waiting", reason, stepKey, ...(until === undefined ? {} : { until }), ...alsoWaitingOf(row) };
}

function keepingOf(row: Row): Keeping {
  return literalOf(keepings, textColumn(row, "kept"));
}

export function keepingGiven(kept: { readonly kept?: Keeping }): Keeping {
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

export function runOf(row: Row): StoredRun {
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

export function stepOf(row: Row): StepRecord {
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

export function eventOf(row: Row): RunEvent {
  return {
    at: textColumn(row, "at"),
    runId: textColumn(row, "run_id"),
    kind: textColumn(row, "kind"),
    detail: jsonColumn(row, "detail"),
  };
}

export function answerOf(row: Row): RecordedAnswer {
  const stepKey = textColumn(row, "step_key");
  const submission = submissionFrom(keptJsonColumn(row, "submission", keepingOf(row)));
  if (submission === undefined) {
    throw new Error(`kernel.db holds an answer for step ${stepKey} without an output.`);
  }
  return { runId: textColumn(row, "run_id"), stepKey, submission, at: textColumn(row, "recorded_at") };
}

export function taskTokenOf(row: Row): StoredTaskToken {
  return {
    hash: textColumn(row, "hash"),
    runId: textColumn(row, "run_id"),
    stepKey: textColumn(row, "step_key"),
    round: integerColumn(row, "round"),
    issuedAt: textColumn(row, "issued_at"),
  };
}

export const stateAssignments =
  "status = ?, waiting_reason = ?, waiting_step = ?, waiting_until = ?, waiting_also = ?, output = ?, reason = ?";

function alsoColumn(also: readonly StoredWait[] | undefined): string | null {
  return also === undefined || also.length === 0 ? null : JSON.stringify(also);
}

export function stateColumns(state: StoredState, keeping: Keeping): readonly SQLInputValue[] {
  switch (state.status) {
    case "running":
      return [state.status, null, null, null, null, null, null];
    case "waiting":
      return [state.status, state.reason, state.stepKey, state.until ?? null, alsoColumn(state.also), null, null];
    case "done":
      return [state.status, null, null, null, null, storedJson(state.output, keeping), null];
    case "failed":
      return [state.status, null, null, null, null, null, state.reason];
    case "undone":
      return [state.status, null, null, null, null, storedJson(state.undo, keeping), state.reason];
  }
}

export function inTransaction<T>(database: DatabaseSync, body: () => T): T {
  database.exec("begin immediate");
  try {
    const result = body();
    database.exec("commit");
    return result;
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
}

export function answered<T>(body: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(body());
  });
}
