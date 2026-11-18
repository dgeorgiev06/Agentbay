import { randomUUID } from "node:crypto";
import { errorLine } from "../answers.ts";
import { runActionFrame } from "./action-steps.ts";
import {
  addBudgets,
  addSpend,
  budgetProblems,
  extendedBudget,
  remainingBudget,
  rootFrame,
  smallestBudget,
  type BudgetFrame,
} from "./budget.ts";
import type { Json, RunEvent, Spend, Submission } from "../contracts.ts";
import type { Budget } from "../generated/mode.ts";
import { byteSize, toJson } from "../json.ts";
import {
  kernelDatabaseFile,
  lockStaleMilliseconds,
  type RunTarget,
  type RunWithSteps,
  type StepRecord,
  type StoredState,
  type Writer,
} from "./run-store.ts";
import type { ApprovalDecision, RunStatus } from "./run-state.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome, type Problem } from "../outcome.ts";
import { answerRefusal } from "./choices.ts";
import type { ApprovalVerdict } from "./step-detail.ts";
import { scrubbedStore } from "./scrubbed-store.ts";
import { startedSkillOf, submissionProblems, type StartedSkill } from "./skill-steps.ts";
import { skillRoundOf } from "./step-key.ts";
import type { ActionTarget } from "../manifests/manifests.ts";
import { hasUndoRecords, runUndo } from "./undo.ts";
import { eventOf, failed, type Progress, type Services, type Walk } from "./walk.ts";
import { runWorkflowSteps } from "./workflow-steps.ts";

type EngineOptions = Services & {
  readonly owner?: string;
  readonly newId?: () => string;
};

type WorkflowReference = {
  readonly mode: string;
  readonly path: string;
};

export type AdvancedRun = {
  readonly id: string;
  readonly spent: Spend;
  readonly state: RunStatus;
};

type CalledFrom = {
  readonly within: Budget;
};

type SkillCall = {
  readonly runId: string;
  readonly stepKey: string;
  readonly mode: string;
  readonly action: string;
  readonly input: Json;
};

type ResumeOptions = {
  readonly rerunUnfinished?: boolean;
};

type Cause = "submit" | "approve" | "resume" | "tick" | "extend" | "stop" | "charge";

type Advance = {
  readonly now: Date;
  readonly cause: Cause;
  readonly rerunUnfinished: boolean;
};

type ControlPatch = {
  readonly extra?: Budget;
  readonly stopReason?: string;
};

type NewRunPlan = {
  readonly target: RunTarget;
  readonly input: Json;
  readonly limit: Budget;
};

type Ending = {
  readonly status: RunStatus;
  readonly spent: Spend;
};

type StartedApproval = Extract<StepRecord, { readonly kind: "approval"; readonly status: "started" }>;

const stopReason = "The owner stopped the run.";

const staleMinutes = String(lockStaleMilliseconds / 60_000);

function refusal(runId: string, wording: { readonly message: string; readonly fix?: string }): Outcome<never> {
  const problem: Problem = { file: kernelDatabaseFile, path: `/runs/${runId}`, ...wording };
  return failedWith([problem]);
}

function refusalOf(runId: string, problems: readonly Problem[]): Outcome<never> {
  return failedWith(
    problems.map(({ message, fix }) => ({
      file: kernelDatabaseFile,
      path: `/runs/${runId}`,
      message,
      ...(fix === undefined ? {} : { fix }),
    })),
  );
}

function describeState(state: StoredState): string {
  switch (state.status) {
    case "running":
      return "running (resume it if no engine is advancing it)";
    case "waiting":
      return `waiting for ${state.reason} at step ${state.stepKey}`;
    case "done":
    case "failed":
    case "undone":
      return state.status;
  }
}

function endedRefusal(run: RunWithSteps): Outcome<never> | undefined {
  const status = run.state.status;
  if (status !== "done" && status !== "failed" && status !== "undone") {
    return undefined;
  }
  return refusal(run.id, { message: `Run ${run.id} has ended (${status}); nothing more can be done with it.` });
}

function waitingRefusal(run: RunWithSteps, expected: { reason: string; stepKey: string }): Outcome<never> | undefined {
  const state = run.state;
  if (state.status === "waiting" && state.reason === expected.reason && state.stepKey === expected.stepKey) {
    return undefined;
  }
  return refusal(run.id, {
    message:
      `Run ${run.id} is not waiting for ${expected.reason} at step ${expected.stepKey}; ` +
      `it is ${describeState(state)}.`,
    fix: "Act on the step the run is waiting for, as resume shows it.",
  });
}

function recordAt(run: RunWithSteps, key: string): StepRecord | undefined {
  return run.steps.find((step) => step.key === key);
}

function waitingSkill(run: RunWithSteps, stepKey: string): Outcome<StartedSkill> {
  const refused = endedRefusal(run) ?? waitingRefusal(run, { reason: "skill", stepKey });
  if (refused !== undefined) {
    return refused;
  }
  const round = skillRoundOf(stepKey);
  const record = startedSkillOf(round === undefined ? undefined : recordAt(run, round.step));
  if (record !== undefined && record.detail.submission === undefined && record.detail.round === round?.round) {
    return succeededWith(record);
  }
  return refusal(run.id, {
    message: `Run ${run.id} already has a submission for ${stepKey}; it is applied once.`,
    fix: "Submit once per round, to the step key the waiting run shows.",
  });
}

function startedApprovalOf(record: StepRecord | undefined): StartedApproval | undefined {
  return record?.kind === "approval" && record.status === "started" ? record : undefined;
}

function verdictOf(decision: ApprovalDecision): ApprovalVerdict {
  const { by } = decision;
  switch (decision.decision) {
    case "approve":
    case "reject":
      return { decision: decision.decision, by };
    case "choice":
      return { decision: decision.decision, choice: decision.choice, by };
  }
}

function answeredApproval(run: RunWithSteps, stepKey: string, decision: ApprovalDecision): Outcome<StartedApproval> {
  const found = waitingApproval(run, stepKey, decision.hash);
  if (!found.ok) {
    return found;
  }
  const { detail, input } = found.value;
  const refused = answerRefusal(stepKey, detail.choices, { answer: decision, shown: detail.shown ?? input });
  return refused === undefined ? found : refusal(run.id, { message: refused });
}

function waitingApproval(run: RunWithSteps, stepKey: string, hash: string): Outcome<StartedApproval> {
  const refused = endedRefusal(run) ?? waitingRefusal(run, { reason: "approval", stepKey });
  const record = startedApprovalOf(recordAt(run, stepKey));
  if (refused !== undefined || record === undefined) {
    return refused ?? refusal(run.id, { message: `Run ${run.id} has no waiting approval ${stepKey}.` });
  }
  if (record.detail.verdict !== undefined) {
    return refusal(run.id, {
      message: `Step ${stepKey} of run ${run.id} already has a decision; it is applied once.`,
      fix: "Resume the run to apply the recorded decision.",
    });
  }
  const shownHash = record.detail.hash;
  if (shownHash === hash) {
    return succeededWith(record);
  }
  return refusal(run.id, {
    message: `The hash ${hash} is not the hash of what step ${stepKey} showed (${shownHash}).`,
    fix: "Approve or reject exactly what the waiting approval shows, naming its hash.",
  });
}

function storedStateOf(status: RunStatus): StoredState {
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

function endingEvents(walk: Walk, status: RunStatus): readonly RunEvent[] {
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

function mainProgress(walk: Walk, run: RunWithSteps, budget: BudgetFrame): Promise<Progress> {
  const system = walk.services.system;
  switch (run.target.kind) {
    case "action": {
      const target = system.action(`${run.target.mode}.${run.target.name}`);
      if (!target.ok) {
        return Promise.resolve(failed(problemText(target.problems)));
      }
      return runActionFrame(walk, { ...target.value, key: "", budget, caller: run.target.caller }, run.input);
    }
    case "workflow": {
      const found = system.workflow(run.target.mode, run.target.name);
      if (!found.ok) {
        return Promise.resolve(failed(problemText(found.problems)));
      }
      const workflow = found.value;
      const scope = {
        workflow,
        budget,
        within: "",
        trigger: run.input,
        outputs: new Map<string, Json>(),
        item: undefined,
      };
      return runWorkflowSteps(walk, scope, { steps: workflow.workflow.steps, start: run.input });
    }
  }
}

async function driveRun(walk: Walk, run: RunWithSteps): Promise<Ending> {
  const budget = rootFrame(extendedBudget(run.limit, walk.extra));
  const progress = await mainProgress(walk, run, budget);
  if (progress.status !== "failed") {
    return { status: progress, spent: budget.spent };
  }
  const undo = await runUndo(walk, progress.reason);
  return { status: undo.status, spent: addSpend(budget.spent, undo.spent) };
}

function notReadOnlyRefusal(target: ActionTarget, action: string): Outcome<never> | undefined {
  const effects = target.action.effects;
  if (effects.every((effect) => effect === "read")) {
    return undefined;
  }
  const message =
    `The action ${action} has the effects ${effects.join(", ")}; a skill may call only actions whose effects ` +
    "are read only.";
  return failedWith([unplacedProblem(message)]);
}

function isDueAt(state: StoredState, now: Date): boolean {
  return (
    state.status === "waiting" &&
    state.reason === "time" &&
    state.until !== undefined &&
    new Date(state.until).getTime() <= now.getTime()
  );
}

export class Engine {
  readonly #services: Services;
  readonly #owner: string;
  readonly #newId: () => string;

  constructor(options: EngineOptions) {
    const { owner, newId, scrubber, store, ...collaborators } = options;
    this.#services = { ...collaborators, store: scrubbedStore(store, scrubber), scrubber };
    this.#owner = owner ?? `engine-${randomUUID()}`;
    this.#newId = newId ?? randomUUID;
  }

  startAction(reference: string, input: Json): Promise<Outcome<AdvancedRun>> {
    const target = this.#services.system.action(reference);
    if (!target.ok) {
      return Promise.resolve(refusalOf("new", target.problems));
    }
    return this.#startTarget(target.value, input);
  }

  async startForSkill(call: SkillCall): Promise<Outcome<AdvancedRun>> {
    const answer = this.#services.system.action(call.action, call.mode);
    if (!answer.ok) {
      return answer;
    }
    const target = answer.value;
    const notReadOnly = notReadOnlyRefusal(target, call.action);
    if (notReadOnly !== undefined) {
      return notReadOnly;
    }
    const calling = await this.#services.store.readRun(call.runId);
    if (calling === undefined) {
      return refusal(call.runId, { message: `There is no run ${call.runId}.` });
    }
    const within = remainingBudget(extendedBudget(calling.limit, calling.extra), calling.spent);
    const called = await this.#startTarget(target, call.input, { within });
    if (!called.ok) {
      return called;
    }
    const charged = await this.#chargeSkill(call, called.value.spent);
    return charged.ok ? called : charged;
  }

  startWorkflow(reference: WorkflowReference, triggerInput: Json): Promise<Outcome<AdvancedRun>> {
    const { mode, path } = reference;
    const found = this.#services.system.workflow(mode, path);
    if (!found.ok) {
      return Promise.resolve(refusalOf("new", found.problems));
    }
    const workflow = found.value.workflow;
    const limit = smallestBudget([workflow.budget, this.#services.system.config.budget]);
    return this.#start({ target: { kind: "workflow", mode, name: path }, input: triggerInput, limit });
  }

  submit(runId: string, stepKey: string, submission: Submission): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      const found = waitingSkill(run, stepKey);
      if (!found.ok) {
        return found;
      }
      const spendProblems = budgetProblems(submission.spent);
      if (spendProblems.length > 0) {
        return refusal(run.id, { message: `The submission's spend is not valid: ${spendProblems.join(" ")}` });
      }
      const problems = await submissionProblems(this.#services, found.value, submission);
      if (problems.length > 0) {
        return failedWith(problems);
      }
      const detail = { ...found.value.detail, submission };
      const change = { key: found.value.key, kind: "skill" as const, detail, at: now.toISOString() };
      await this.#services.store.saveStepDetail(writer, change, []);
      return this.#continue(writer, { now, cause: "submit", rerunUnfinished: false }, {});
    });
  }

  approve(runId: string, stepKey: string, decision: ApprovalDecision): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      const found = answeredApproval(run, stepKey, decision);
      if (!found.ok) {
        return found;
      }
      const detail = { ...found.value.detail, verdict: verdictOf(decision) };
      const change = { key: stepKey, kind: "approval" as const, detail, at: now.toISOString() };
      await this.#services.store.saveStepDetail(writer, change, []);
      return this.#continue(writer, { now, cause: "approve", rerunUnfinished: false }, {});
    });
  }

  resume(runId: string, options: ResumeOptions = {}): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      const rerunUnfinished = options.rerunUnfinished ?? false;
      return endedRefusal(run) ?? this.#continue(writer, { now, cause: "resume", rerunUnfinished }, {});
    });
  }

  async tick(now: Date): Promise<readonly Outcome<AdvancedRun>[]> {
    const waitingRuns = await this.#services.store.listRuns("waiting");
    const results: Outcome<AdvancedRun>[] = [];
    for (const run of waitingRuns.filter((candidate) => isDueAt(candidate.state, now))) {
      const result = await this.#withRun(run.id, now, (current, writer) =>
        isDueAt(current.state, now)
          ? this.#continue(writer, { now, cause: "tick", rerunUnfinished: false }, {})
          : Promise.resolve(refusal(run.id, { message: `Run ${run.id} is no longer waiting for time.` })),
      );
      results.push(result);
    }
    return results;
  }

  extendBudget(runId: string, extra: Budget): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      const problems = budgetProblems(extra);
      if (problems.length > 0) {
        return refusal(run.id, { message: `The extension is not valid: ${problems.join(" ")}` });
      }
      const total = addBudgets(run.extra, extra);
      return (
        endedRefusal(run) ?? this.#continue(writer, { now, cause: "extend", rerunUnfinished: false }, { extra: total })
      );
    });
  }

  stop(runId: string): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      return (
        endedRefusal(run) ?? this.#continue(writer, { now, cause: "stop", rerunUnfinished: false }, { stopReason })
      );
    });
  }

  async #startTarget(target: ActionTarget, input: Json, from?: CalledFrom): Promise<Outcome<AdvancedRun>> {
    const checked = target.input.check(input);
    if (!checked.ok) {
      return checked;
    }
    const caller = target.caller === undefined ? {} : { caller: target.caller };
    const runTarget: RunTarget = { kind: "action", mode: target.mode.manifest.name, name: target.name, ...caller };
    const limit = smallestBudget([target.action.budget, this.#services.system.config.budget, from?.within]);
    return this.#start({ target: runTarget, input, limit });
  }

  #chargeSkill(call: SkillCall, spent: Spend): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(call.runId, this.#services.clock.now(), async (run, writer, now) => {
      const found = waitingSkill(run, call.stepKey);
      if (!found.ok) {
        return found;
      }
      const detail = { ...found.value.detail, calledSpent: addSpend(found.value.detail.calledSpent, spent) };
      const change = { key: found.value.key, kind: "skill" as const, detail, at: now.toISOString() };
      await this.#services.store.saveStepDetail(writer, change, []);
      return this.#advance(writer, { now, cause: "charge", rerunUnfinished: false });
    });
  }

  async #start(plan: NewRunPlan): Promise<Outcome<AdvancedRun>> {
    const id = this.#newId();
    if ((await this.#services.store.readRun(id)) !== undefined) {
      return refusal(id, { message: `A run with the id ${id} already exists.` });
    }
    const now = this.#services.clock.now();
    const started: RunEvent = {
      at: now.toISOString(),
      runId: id,
      kind: "run.started",
      detail: {
        target: plan.target.kind,
        mode: plan.target.mode,
        name: plan.target.name,
        inputBytes: byteSize(plan.input),
      },
    };
    const newRun = { id, ...plan, at: now.toISOString() };
    const writer = await this.#services.store.createRun(newRun, this.#owner, [started]);
    return this.#holding(writer, () => this.#advance(writer, { now, cause: "resume", rerunUnfinished: false }));
  }

  async #withRun(
    runId: string,
    now: Date,
    body: (run: RunWithSteps, writer: Writer, now: Date) => Promise<Outcome<AdvancedRun>>,
  ): Promise<Outcome<AdvancedRun>> {
    const lock = await this.#services.store.acquire(runId, this.#owner, now);
    switch (lock.status) {
      case "missing":
        return refusal(runId, { message: `There is no run ${runId}.` });
      case "busy":
        return refusal(runId, {
          message: `Another engine is writing run ${runId}; try again.`,
          fix: "Try again in a moment.",
        });
      case "held":
        return refusal(runId, {
          message:
            `Run ${runId} is being advanced by ${lock.owner} (last heartbeat ${lock.heartbeatAt}); ` +
            "only one writer may advance a run at a time.",
          fix: `Try again when it is done, or after ${staleMinutes} minutes without a heartbeat.`,
        });
      case "acquired":
        return this.#holding(lock.writer, async () => {
          const run = await this.#read(runId);
          return this.#targetRefusal(run) ?? body(run, lock.writer, now);
        });
    }
  }

  #targetRefusal(run: RunWithSteps): Outcome<AdvancedRun> | undefined {
    const system = this.#services.system;
    const { kind, mode, name } = run.target;
    const answer = kind === "action" ? system.action(`${mode}.${name}`) : system.workflow(mode, name);
    return answer.ok ? undefined : refusalOf(run.id, answer.problems);
  }

  async #holding(writer: Writer, body: () => Promise<Outcome<AdvancedRun>>): Promise<Outcome<AdvancedRun>> {
    try {
      return await body();
    } catch (error) {
      return refusal(writer.runId, {
        message: this.#services.scrubber.redact(
          `Run ${writer.runId} stopped at an unexpected error: ${errorLine(error)}`,
        ),
        fix: `Fix the cause, then continue it with bay resume ${writer.runId}.`,
      });
    } finally {
      await this.#services.store.release(writer);
    }
  }

  async #read(runId: string): Promise<RunWithSteps> {
    const run = await this.#services.store.readRun(runId);
    if (run === undefined) {
      throw new Error(`Run ${runId} vanished while its lock was held.`);
    }
    return run;
  }

  async #continue(writer: Writer, advance: Advance, patch: ControlPatch): Promise<Outcome<AdvancedRun>> {
    const resumed: RunEvent = {
      at: advance.now.toISOString(),
      runId: writer.runId,
      kind: "run.resumed",
      detail: { cause: advance.cause },
    };
    const update = { ...patch, state: { status: "running" as const }, at: advance.now.toISOString() };
    await this.#services.store.updateRun(writer, update, [resumed]);
    return this.#advance(writer, advance);
  }

  async #advance(writer: Writer, advance: Advance): Promise<Outcome<AdvancedRun>> {
    const run = await this.#read(writer.runId);
    const walk: Walk = {
      services: this.#services,
      writer,
      records: new Map(run.steps.map((step) => [step.key, step])),
      events: await this.#services.store.readEvents(run.id),
      now: advance.now,
      rerunUnfinished: advance.rerunUnfinished,
      stopReason: run.stopReason,
      extra: run.extra,
      phase: "main",
    };
    const ending = await driveRun(walk, run);
    const update = { state: storedStateOf(ending.status), spent: ending.spent, at: advance.now.toISOString() };
    await this.#services.store.updateRun(writer, update, endingEvents(walk, ending.status));
    return succeededWith({ id: run.id, state: ending.status, spent: ending.spent });
  }
}
