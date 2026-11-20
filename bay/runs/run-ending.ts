import type { RunEvent } from "../contracts.ts";
import { toJson } from "../json.ts";
import { storedWaits, type StoredState, type StoredWait } from "./run-store.ts";
import { waitsIn, type RunStatus, type Waiting } from "./run-state.ts";
import { hasUndoRecords } from "./undo.ts";
import { eventOf, type Walk } from "./walk.ts";

function storedWaitOf(waiting: Waiting): StoredWait {
  const until = waiting.reason === "time" ? { until: waiting.until } : {};
  return { reason: waiting.reason, stepKey: waiting.stepKey, ...until };
}

function waitEvents(walk: Walk, waiting: Waiting): readonly RunEvent[] {
  const waited = eventOf(walk, "run.waiting", { reason: waiting.reason, stepKey: waiting.stepKey });
  if (waiting.reason !== "budget") {
    return [waited];
  }
  return [eventOf(walk, "budget.exceeded", { stepKey: waiting.stepKey, ...waiting.overrun }), waited];
}

export function storedStateOf(status: RunStatus): StoredState {
  switch (status.status) {
    case "waiting": {
      const [lead, ...also] = waitsIn(status).map(storedWaitOf);
      const others = also.length === 0 ? {} : { also };
      return { status: "waiting", ...(lead ?? storedWaitOf(status.waiting)), ...others };
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
    case "waiting":
      return waitsIn(status).flatMap((waiting) => waitEvents(walk, waiting));
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

function isDue(wait: StoredWait, now: Date): boolean {
  return wait.reason === "time" && wait.until !== undefined && new Date(wait.until).getTime() <= now.getTime();
}

export function isDueAt(state: StoredState, now: Date): boolean {
  return storedWaits(state).some((wait) => isDue(wait, now));
}
