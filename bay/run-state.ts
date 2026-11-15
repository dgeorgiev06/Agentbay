import type { Overrun } from "./budget.ts";
import type { Json, SkillTask, Spend } from "./contracts.ts";
import type { RunTarget, StepRecord } from "./run-store.ts";
import type { Problem } from "./spec.ts";

export type Waiting =
  | { readonly reason: "skill"; readonly stepKey: string; readonly task: SkillTask }
  | {
      readonly reason: "approval";
      readonly stepKey: string;
      readonly question: string;
      readonly hash: string;
      readonly content: Json;
      readonly previousHash?: string;
    }
  | { readonly reason: "time"; readonly stepKey: string; readonly until: string }
  | { readonly reason: "budget"; readonly stepKey: string; readonly overrun: Overrun }
  | { readonly reason: "owner"; readonly stepKey: string; readonly question: string };

export type UndoEntry = {
  readonly stepKey: string;
  readonly action: string;
};

export type UndoReport = {
  readonly undone: readonly UndoEntry[];
  readonly failed: readonly (UndoEntry & { readonly reason: string })[];
  readonly noUndo: readonly UndoEntry[];
  readonly deleteNotUndone: readonly UndoEntry[];
};

export type RunStatus =
  | { readonly status: "waiting"; readonly waiting: Waiting }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "undone"; readonly reason: string; readonly undo: UndoReport };

export type RunView = {
  readonly id: string;
  readonly target: RunTarget;
  readonly state: RunStatus;
  readonly spent: Spend;
  readonly steps: readonly StepRecord[];
};

export type EngineResult =
  { readonly ok: true; readonly run: RunView } | { readonly ok: false; readonly problems: readonly Problem[] };

export type ApprovalDecision = {
  readonly hash: string;
  readonly decision: "approve" | "reject";
  readonly by: string;
};
