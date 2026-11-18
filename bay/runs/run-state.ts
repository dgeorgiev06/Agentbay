import type { Overrun } from "./budget.ts";
import type { Json, Permissions, StepPlace, Tier } from "../contracts.ts";
import type { ApprovalAnswer, Choice } from "./choices.ts";

export type SkillTask = {
  readonly runId: string;
  readonly stepKey: string;
  readonly round: number;
  readonly feedback: readonly string[];
  readonly skill: string;
  readonly tier: Tier;
  readonly input: Json;
  readonly files: { readonly skill: string; readonly outputSchema: string; readonly alsoMatches: readonly string[] };
  readonly place: StepPlace;
  readonly permissions: Permissions;
  readonly toolCalls: number;
};

export type Waiting<HandedTask extends SkillTask = SkillTask> =
  | { readonly reason: "skill"; readonly stepKey: string; readonly task: HandedTask }
  | {
      readonly reason: "approval";
      readonly stepKey: string;
      readonly question: string;
      readonly hash: string;
      readonly content: Json;
      readonly previousHash?: string;
      readonly choices?: readonly Choice[];
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

export type RunState<HandedTask extends SkillTask = SkillTask> =
  | { readonly status: "running" }
  | { readonly status: "waiting"; readonly waiting: Waiting<HandedTask> }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "undone"; readonly reason: string; readonly undo: UndoReport };

export type RunStatus = Exclude<RunState, { readonly status: "running" }>;

export type ApprovalDecision = ApprovalAnswer & {
  readonly hash: string;
  readonly by: string;
};
