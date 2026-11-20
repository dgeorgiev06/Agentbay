import type { RunEvent } from "../contracts.ts";
import { toJson } from "../json.ts";
import type { StoredState } from "./run-store.ts";
import type { RunStatus } from "./run-state.ts";
import { hasUndoRecords } from "./undo.ts";
import { eventOf, type Walk } from "./walk.ts";

export function storedStateOf(status: RunStatus): StoredState {
  switch (status.status) {
    case "waiting": {
      const waiting = status.waiting;
      const until = waiting.reason === "time" ? { until: waiting.until } : {};
      return { status: "waiting", reason: waiting.reason, stepKey: waiting.stepKey, ...until };
    }
    case "done":
      return { status: "done", output: status.output };
    case "failed":
      return { status: "failed", reason: status.reason };
    case "undone":
      return { status: "undone", reason: status.reason, undo: toJson(status.undo) };
  }
}

export function endingEvents(walk: Walk, status: RunStatus): readonly RunEvent[] {
  switch (status.status) {
    case "waiting": {
      const waiting = status.waiting;
      const waited = eventOf(walk, "run.waiting", { reason: waiting.reason, stepKey: waiting.stepKey });
      if (waiting.reason !== "budget") {
        return [waited];
      }
      return [eventOf(walk, "budget.exceeded", { stepKey: waiting.stepKey, ...waiting.overrun }), waited];
    }
    case "done":
    case "failed":
      return [eventOf(walk, "run.finished", { status: status.status })];
    case "undone":
      return undoneEvents(walk, status);
  }
}

function undoneEvents(walk: Walk, status: RunStatus & { readonly status: "undone" }): readonly RunEvent[] {
  const counts = {
    undone: status.undo.undone.length,
    failed: status.undo.failed.length,
    noUndo: status.undo.noUndo.length,
    deleteNotUndone: status.undo.deleteNotUndone.length,
  };
  const started = hasUndoRecords(walk.records) ? [] : [eventOf(walk, "undo.started", {})];
  return [...started, eventOf(walk, "undo.finished", counts), eventOf(walk, "run.finished", { status: status.status })];
}

export function isDueAt(state: StoredState, now: Date): boolean {
  return (
    state.status === "waiting" &&
    state.reason === "time" &&
    state.until !== undefined &&
    new Date(state.until).getTime() <= now.getTime()
  );
}
