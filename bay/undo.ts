import { runNestedAction } from "./action-steps.ts";
import { noSpend, rootFrame, type BudgetFrame } from "./budget.ts";
import type { Json, Spend } from "./contracts.ts";
import type { Action } from "./generated/mode.ts";
import { textField } from "./json.ts";
import type { System } from "./registry.ts";
import type { StepRecord } from "./run-store.ts";
import type { RunStatus, UndoEntry, UndoReport } from "./run-state.ts";
import { resolveOwnAction, type ActionTarget } from "./targets.ts";
import { eventOf, type Progress, type Walk } from "./walk.ts";

const undoPrefix = "undo[";

type FinishedAction = {
  readonly entry: UndoEntry;
  readonly caller: string | undefined;
  readonly key: string;
  readonly output: Json;
  readonly finishOrder: number;
  readonly action: Action | undefined;
  readonly target: ActionTarget | string;
};

type UndoPlan = {
  readonly toUndo: readonly FinishedAction[];
  readonly noUndo: readonly UndoEntry[];
  readonly deleteNotUndone: readonly UndoEntry[];
};

type Classification = "undo" | "no-undo" | "delete" | "nothing";

export type UndoOutcome = {
  readonly status: RunStatus;
  readonly spent: Spend;
};

function undoTargetOf(system: System, mode: string, action: Action | undefined): ActionTarget | string {
  if (action?.undo === undefined) {
    return `The action has no undo.`;
  }
  return resolveOwnAction(system, mode, action.undo);
}

function finishedActionOf(system: System, record: StepRecord): FinishedAction | undefined {
  if (record.status !== "finished" || (record.kind !== "call" && record.kind !== "action")) {
    return undefined;
  }
  if (record.key.startsWith(undoPrefix)) {
    return undefined;
  }
  const modeName = textField(record.detail, "mode") ?? "";
  const actionName = textField(record.detail, "action") ?? "";
  const target = resolveOwnAction(system, modeName, actionName);
  const action = typeof target === "string" ? undefined : target.action;
  return {
    entry: { stepKey: record.key, action: `${modeName}.${actionName}` },
    caller: textField(record.detail, "caller"),
    key: record.key,
    output: record.output,
    finishOrder: record.finishOrder,
    action,
    target: undoTargetOf(system, modeName, action),
  };
}

function classify(finished: FinishedAction): Classification {
  const effects = finished.action?.effects ?? ["write"];
  if (effects.includes("delete")) {
    return "delete";
  }
  if (finished.action?.undo !== undefined) {
    return "undo";
  }
  return effects.some((effect) => effect !== "read") ? "no-undo" : "nothing";
}

function coversItsSteps(finished: FinishedAction): boolean {
  const classification = classify(finished);
  return classification === "undo" || classification === "delete";
}

function isCovered(finished: FinishedAction, all: readonly FinishedAction[]): boolean {
  return all.some((outer) => finished.key.startsWith(`${outer.key}/`) && coversItsSteps(outer));
}

export function undoPlan(system: System, records: readonly StepRecord[]): UndoPlan {
  const all = records.flatMap((record) => finishedActionOf(system, record) ?? []);
  const uncovered = all
    .filter((finished) => !isCovered(finished, all))
    .sort((first, second) => second.finishOrder - first.finishOrder);
  return {
    toUndo: uncovered.filter((finished) => classify(finished) === "undo"),
    noUndo: uncovered.filter((finished) => classify(finished) === "no-undo").map((finished) => finished.entry),
    deleteNotUndone: uncovered.filter((finished) => classify(finished) === "delete").map((finished) => finished.entry),
  };
}

function isNeeded(plan: UndoPlan): boolean {
  return plan.toUndo.length + plan.noUndo.length + plan.deleteNotUndone.length > 0;
}

export function hasUndoRecords(records: ReadonlyMap<string, StepRecord>): boolean {
  return [...records.keys()].some((key) => key.startsWith(undoPrefix));
}

function undoOne(
  walk: Walk,
  budget: BudgetFrame,
  at: {
    readonly index: number;
    readonly target: ActionTarget;
    readonly input: Json;
    readonly caller: string | undefined;
  },
): Promise<Progress> {
  const key = `${undoPrefix}${String(at.index)}]`;
  const events = hasUndoRecords(walk.records) ? [] : [eventOf(walk, "undo.started", {})];
  const nested = { key, kind: "undo" as const, target: at.target, input: at.input, caller: at.caller, events };
  return runNestedAction(walk, budget, nested);
}

export async function runUndo(walk: Walk, reason: string): Promise<UndoOutcome> {
  const plan = undoPlan(walk.services.system, [...walk.records.values()]);
  if (!isNeeded(plan)) {
    return { status: { status: "failed", reason }, spent: noSpend };
  }
  const undoWalk: Walk = { ...walk, phase: "undo" };
  const budget = rootFrame({});
  const undone: UndoEntry[] = [];
  const failedUndos: (UndoEntry & { readonly reason: string })[] = [];
  for (const [index, finished] of plan.toUndo.entries()) {
    if (typeof finished.target === "string") {
      failedUndos.push({ ...finished.entry, reason: finished.target });
      continue;
    }
    const at = { index, target: finished.target, input: finished.output, caller: finished.caller };
    const progress = await undoOne(undoWalk, budget, at);
    switch (progress.kind) {
      case "waiting":
        return { status: { status: "waiting", waiting: progress.waiting }, spent: budget.spent };
      case "done":
        undone.push(finished.entry);
        break;
      case "failed":
        failedUndos.push({ ...finished.entry, reason: progress.reason });
        break;
    }
  }
  const undo: UndoReport = { undone, failed: failedUndos, noUndo: plan.noUndo, deleteNotUndone: plan.deleteNotUndone };
  return { status: { status: "undone", reason, undo }, spent: budget.spent };
}
