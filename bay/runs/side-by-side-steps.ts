import { addSpend, charge, itemFrame, noSpend, sharedFrame, type BudgetFrame } from "./budget.ts";
import type { Json, Spend } from "../contracts.ts";
import type { Step as WorkflowStep } from "../generated/workflow.ts";
import type { StepRecord } from "./run-store.ts";
import {
  attemptsAfterRerun,
  foreachEnd,
  itemsRerun,
  itemsToStart,
  type ItemEnd,
  type ItemPhase,
} from "./side-by-side.ts";
import type { ForeachDetail } from "./step-detail.ts";
import { foreachItemKey } from "./step-key.ts";
import { changeDetail, endRecord, waitingOn, type Progress, type Walk } from "./walk.ts";
import type { StepAt, StepsRunner, WorkflowScope } from "./workflow-scope.ts";

type ForeachStep = Extract<WorkflowStep, { readonly foreach: string }>;

export type SideBySideLoop = {
  readonly at: StepAt<ForeachStep>;
  readonly items: readonly Json[];
  readonly runSteps: StepsRunner;
  readonly cap: number;
  readonly record: StepRecord | undefined;
};

type ItemRun = {
  readonly end: ItemEnd;
  readonly spent: Spend;
};

type Pass = {
  readonly loop: SideBySideLoop;
  readonly shared: BudgetFrame;
  readonly attempts: readonly number[];
  readonly indexes: readonly number[];
};

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

function detailOf(record: StepRecord | undefined, count: number): ForeachDetail {
  const stored = record?.kind === "foreach" ? record.detail : null;
  const attempts = stored?.attempts.length === count ? stored.attempts : Array.from({ length: count }, () => 1);
  const question = stored?.question;
  return { attempts, earlierSpent: stored?.earlierSpent ?? noSpend, ...(question === undefined ? {} : { question }) };
}

function itemEndOf(progress: Progress, key: string): ItemEnd {
  switch (progress.status) {
    case "done":
      return { kind: "done", output: progress.output };
    case "failed":
      return { kind: "failed", key, reason: progress.reason };
    case "waiting":
      return { kind: "waiting", waits: [progress.waiting, ...(progress.alsoWaiting ?? [])] };
  }
}

async function settled<T>(work: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error };
  }
}

async function sideBySide<T>(count: number, cap: number, run: (index: number) => Promise<T>): Promise<readonly T[]> {
  const phases: ItemPhase[] = Array.from({ length: count }, () => "queued");
  const results = new Map<number, Settled<T>>();
  const running = new Map<number, Promise<number>>();
  for (;;) {
    for (const index of itemsToStart(phases, cap)) {
      phases[index] = "running";
      const finished = async (): Promise<number> => {
        results.set(index, await settled(run(index)));
        return index;
      };
      running.set(index, finished());
    }
    if (running.size === 0) {
      break;
    }
    const ended = await Promise.race(running.values());
    running.delete(ended);
    phases[ended] = "ended";
  }
  return [...results.entries()].sort(([first], [second]) => first - second).map(([, result]) => valueOf(result));
}

function valueOf<T>(result: Settled<T>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

async function runItem(
  walk: Walk,
  scope: WorkflowScope,
  at: { readonly pass: Pass; readonly index: number },
): Promise<ItemRun> {
  const { pass, index } = at;
  const { loop } = pass;
  const within = foreachItemKey(loop.at.key, index, pass.attempts[index] ?? 1);
  const budget = itemFrame(pass.shared);
  const item = loop.items[index] ?? null;
  const inner = { ...scope, budget, within, outputs: new Map(scope.outputs), keys: new Map(scope.keys), item };
  const progress = await loop.runSteps(walk, inner, { steps: loop.at.step.steps, start: item });
  return { end: itemEndOf(progress, within), spent: budget.spent };
}

async function runPass(walk: Walk, scope: WorkflowScope, pass: Pass): Promise<readonly ItemRun[]> {
  return sideBySide(pass.indexes.length, pass.loop.cap, (position) =>
    runItem(walk, scope, { pass, index: pass.indexes[position] ?? 0 }),
  );
}

function spentBy(runs: readonly ItemRun[], indexes: readonly number[]): Spend {
  return indexes.reduce((total, index) => addSpend(total, runs[index]?.spent ?? noSpend), noSpend);
}

async function rerunFailed(
  walk: Walk,
  scope: WorkflowScope,
  first: { readonly pass: Pass; readonly runs: readonly ItemRun[]; readonly detail: ForeachDetail },
): Promise<readonly ItemRun[]> {
  const { pass, runs, detail } = first;
  const attempts = attemptsAfterRerun(
    pass.attempts,
    runs.map((run) => run.end),
  );
  const indexes = itemsRerun(pass.attempts, attempts);
  if (indexes.length === 0) {
    return runs;
  }
  const earlierSpent = addSpend(detail.earlierSpent, spentBy(runs, indexes));
  await changeDetail(walk, { key: pass.loop.at.key, kind: "foreach", detail: { attempts, earlierSpent } });
  const again = await runPass(walk, scope, { ...pass, attempts, indexes });
  return runs.map((run, index) => again[indexes.indexOf(index)] ?? run);
}

async function concluded(
  walk: Walk,
  loop: SideBySideLoop,
  at: { readonly ends: readonly ItemEnd[]; readonly shared: BudgetFrame; readonly detail: ForeachDetail },
): Promise<Progress> {
  const { key, step } = loop.at;
  const stopped = walk.phase === "main" && walk.stopReason !== undefined;
  const end = foreachEnd(at.ends, { stepId: step.id, key, stopped });
  switch (end.kind) {
    case "done":
      return endRecord(walk, { key, status: "done", output: [...end.outputs], spent: at.shared.spent });
    case "failed":
      return endRecord(walk, { key, status: "failed", reason: end.reason, spent: at.shared.spent });
    case "waiting":
      return waitingOn(end.lead, end.others);
    case "asking":
      if (at.detail.question !== end.question) {
        await changeDetail(walk, { key, kind: "foreach", detail: { ...at.detail, question: end.question } });
      }
      return waitingOn(end.lead, end.others);
  }
}

export async function runSideBySide(walk: Walk, scope: WorkflowScope, loop: SideBySideLoop): Promise<Progress> {
  const detail = detailOf(loop.record, loop.items.length);
  const shared = sharedFrame(scope.budget);
  charge(shared, detail.earlierSpent);
  const indexes = loop.items.map((_, index) => index);
  const pass = { loop, shared, attempts: detail.attempts, indexes };
  const runs = await runPass(walk, scope, pass);
  const rerun = walk.rerunUnfinished && walk.stopReason === undefined;
  const final = rerun ? await rerunFailed(walk, scope, { pass, runs, detail }) : runs;
  const latest = detailOf(walk.records.get(loop.at.key), loop.items.length);
  return concluded(walk, loop, { ends: final.map((run) => run.end), shared, detail: latest });
}
