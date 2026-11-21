import { randomUUID } from "node:crypto";
import { errorLine } from "../answers.ts";
import { runActionFrame } from "./action-steps.ts";
import {
  addBudgets,
  addSpend,
  budgetProblems,
  extendedBudget,
  noSpend,
  remainingBudget,
  rootFrame,
  smallestBudget,
  type BudgetFrame,
} from "./budget.ts";
import type { Json, RunEvent, Spend, Submission } from "../contracts.ts";
import type { Budget, Keeping } from "../generated/mode.ts";
import { byteSize } from "../json.ts";
import {
  lockStaleMilliseconds,
  type RecordedAnswer,
  type Recording,
  type RunTarget,
  type RunWithSteps,
  type Writer,
} from "./run-store.ts";
import type { ApprovalDecision, RunStatus } from "./run-state.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome, type Problem } from "../outcome.ts";
import { keepingOf } from "./packed-output.ts";
import { scrubbedStore } from "./scrubbed-store.ts";
import { submissionProblems, type StartedSkill } from "./skill-steps.ts";
import type { ActionTarget } from "../manifests/manifests.ts";
import { runUndo } from "./undo.ts";
import {
  answerableSkill,
  answeredApproval,
  endedRefusal,
  refusal,
  refusalOf,
  verdictOf,
  waitingSkill,
} from "./run-answers.ts";
import { endingEvents, isDueAt, storedStateOf } from "./run-ending.ts";
import { failed, type Progress, type Services, type Walk } from "./walk.ts";
import { givenRecords, type GivenRecord } from "./given-steps.ts";
import { givenKind, partMarkOf, untilIn, type PartMark, type WorkflowPart } from "./workflow-part.ts";
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

type RunBody = (run: RunWithSteps, writer: Writer, now: Date) => Promise<Outcome<AdvancedRun>>;

export type Submitted = AdvancedRun | { readonly id: string; readonly recorded: string };

type Advance =
  | { readonly now: Date; readonly cause: "submit" | "approve" | "resume" | "tick" | "charge" }
  | { readonly now: Date; readonly cause: "rerun" | "extend" | "stop"; readonly by: string };

type ControlPatch = {
  readonly extra?: Budget;
  readonly stopReason?: string;
};

type NewRunPlan = {
  readonly target: RunTarget;
  readonly kept: Keeping;
  readonly input: Json;
  readonly limit: Budget;
};

type Ending = {
  readonly status: RunStatus;
  readonly spent: Spend;
};

type GivenPart = {
  readonly mark: PartMark;
  readonly records: readonly GivenRecord[];
};

const answerRecordedKind = "answer.recorded";

const answerDroppedKind = "answer.dropped";

const staleMinutes = String(lockStaleMilliseconds / 60_000);

function mainProgress(walk: Walk, run: RunWithSteps, budget: BudgetFrame): Promise<Progress> {
  const system = walk.services.system;
  switch (run.target.kind) {
    case "action": {
      const target = system.action(`${run.target.mode}.${run.target.name}`);
      if (!target.ok) {
        return Promise.resolve(failed(problemText(target.problems)));
      }
      const frame = { ...target.value, key: "", budget, caller: run.target.caller, within: "as-text" as const };
      return runActionFrame(walk, frame, run.input);
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
        keys: new Map<string, string>(),
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

function busyRefusal(runId: string): Outcome<never> {
  return refusal(runId, {
    message: `Another engine is writing run ${runId}; try again.`,
    fix: "Try again in a moment.",
  });
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
    const charged = await this.#chargeSkill(call, called.value);
    return charged.ok ? called : charged;
  }

  startWorkflow(reference: WorkflowReference, triggerInput: Json): Promise<Outcome<AdvancedRun>> {
    return this.startWorkflowPart(reference, triggerInput, undefined);
  }

  startWorkflowPart(
    reference: WorkflowReference,
    triggerInput: Json,
    part: WorkflowPart | undefined,
  ): Promise<Outcome<AdvancedRun>> {
    const { mode, path } = reference;
    const found = this.#services.system.workflow(mode, path);
    if (!found.ok) {
      return Promise.resolve(refusalOf("new", found.problems));
    }
    const workflow = found.value.workflow;
    const limit = smallestBudget([workflow.budget, this.#services.system.config.budget]);
    const target: RunTarget = { kind: "workflow", mode, name: path };
    const plan = { target, kept: "as-text" as const, input: triggerInput, limit };
    if (part === undefined) {
      return this.#start(plan);
    }
    const { system, scrubber } = this.#services;
    const records = givenRecords({ system, scrubber, workflow: found.value, trigger: triggerInput }, part);
    if (!records.ok) {
      return Promise.resolve(refusalOf("new", records.problems));
    }
    return this.#start(plan, { mark: partMarkOf(part), records: records.value });
  }

  async submit(runId: string, stepKey: string, submission: Submission): Promise<Outcome<Submitted>> {
    const now = this.#services.clock.now();
    const store = this.#services.store;
    const rule = (run: RunWithSteps | undefined, recorded: ReadonlySet<string>): Outcome<StartedSkill> =>
      answerableSkill(run, stepKey, recorded);
    const found = rule(await store.readRun(runId), await this.#answeredKeys(runId));
    if (!found.ok) {
      return found;
    }
    const problems = await this.#answerProblems(found.value, submission);
    if (problems.length > 0) {
      return failedWith(problems);
    }
    const answer = { runId, stepKey, submission, at: now.toISOString() };
    const recording = await store.recordAnswer(answer, { owner: this.#owner, now }, rule);
    return this.#afterRecording(answer, recording);
  }

  async #answerProblems(record: StartedSkill, submission: Submission): Promise<readonly Problem[]> {
    const spendProblems = budgetProblems(submission.spent);
    if (spendProblems.length > 0) {
      return [unplacedProblem(`The submission's spend is not valid: ${spendProblems.join(" ")}`)];
    }
    return submissionProblems(this.#services, record, submission);
  }

  async #answeredKeys(runId: string): Promise<ReadonlySet<string>> {
    const answers = await this.#services.store.recordedAnswers(runId);
    return new Set(answers.map((answer) => answer.stepKey));
  }

  async #afterRecording(answer: RecordedAnswer, recording: Recording): Promise<Outcome<Submitted>> {
    const { runId, stepKey, at } = answer;
    switch (recording.status) {
      case "refused":
        return failedWith(recording.problems);
      case "busy":
        return busyRefusal(runId);
      case "recorded":
        await this.#services.store.append({ at, runId, kind: answerRecordedKind, detail: { stepKey } });
        return succeededWith({ id: runId, recorded: stepKey });
      case "taken":
        return this.#heldRun(recording.writer, this.#services.clock.now(), () => this.#takeAnswers(recording.writer));
    }
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
      return this.#continue(writer, { now, cause: "approve" }, {});
    });
  }

  resume(runId: string): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      return endedRefusal(run) ?? this.#continue(writer, { now, cause: "resume" }, {});
    });
  }

  rerun(runId: string, by: string): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      return endedRefusal(run) ?? this.#continue(writer, { now, cause: "rerun", by }, {});
    });
  }

  async tick(now: Date): Promise<readonly Outcome<AdvancedRun>[]> {
    const waitingRuns = await this.#services.store.listRuns("waiting");
    const results: Outcome<AdvancedRun>[] = [];
    for (const run of waitingRuns.filter((candidate) => isDueAt(candidate.state, now))) {
      const result = await this.#withRun(run.id, now, (current, writer) =>
        isDueAt(current.state, now)
          ? this.#continue(writer, { now, cause: "tick" }, {})
          : Promise.resolve(refusal(run.id, { message: `Run ${run.id} is no longer waiting for time.` })),
      );
      results.push(result);
    }
    return results;
  }

  extendBudget(runId: string, extra: Budget, by: string): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      const problems = budgetProblems(extra);
      if (problems.length > 0) {
        return refusal(run.id, { message: `The extension is not valid: ${problems.join(" ")}` });
      }
      const total = addBudgets(run.extra, extra);
      const advance = { now, cause: "extend" as const, by };
      return endedRefusal(run) ?? this.#continue(writer, advance, { extra: total });
    });
  }

  stop(runId: string, by: string): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(runId, this.#services.clock.now(), async (run, writer, now) => {
      const advance = { now, cause: "stop" as const, by };
      return endedRefusal(run) ?? this.#continue(writer, advance, { stopReason: `${by} stopped the run.` });
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
    return this.#start({ target: runTarget, kept: keepingOf(target.action), input, limit });
  }

  #chargeSkill(call: SkillCall, called: AdvancedRun): Promise<Outcome<AdvancedRun>> {
    return this.#withRun(call.runId, this.#services.clock.now(), async (run, writer, now) => {
      const found = waitingSkill(run, call.stepKey);
      if (!found.ok) {
        return found;
      }
      const before = found.value.detail;
      const calledRuns = [...(before.calledRuns ?? []), called.id];
      const detail = { ...before, calledSpent: addSpend(before.calledSpent, called.spent), calledRuns };
      const change = { key: found.value.key, kind: "skill" as const, detail, at: now.toISOString() };
      await this.#services.store.saveStepDetail(writer, change, []);
      return this.#advance(writer, { now, cause: "charge" });
    });
  }

  async #start(plan: NewRunPlan, part?: GivenPart): Promise<Outcome<AdvancedRun>> {
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
        ...(part === undefined ? {} : { part: part.mark }),
      },
    };
    const newRun = { id, ...plan, at: now.toISOString() };
    const writer = await this.#services.store.createRun(newRun, this.#owner, [started]);
    return this.#holding(writer, async () => {
      await this.#saveGiven(writer, part?.records ?? [], now.toISOString());
      return this.#advance(writer, { now, cause: "resume" });
    });
  }

  async #saveGiven(writer: Writer, records: readonly GivenRecord[], at: string): Promise<void> {
    const store = this.#services.store;
    for (const { output, ...start } of records) {
      const detail = { stepKey: start.key, kind: start.kind, outputBytes: byteSize(output) };
      const given: RunEvent = { at, runId: writer.runId, kind: givenKind, detail };
      await store.saveStepInput(writer, { ...start, at }, []);
      await store.saveStepOutput(writer, { key: start.key, status: "done", output, spent: noSpend, at }, [given]);
    }
  }

  async #withRun(runId: string, now: Date, body: RunBody): Promise<Outcome<AdvancedRun>> {
    const lock = await this.#services.store.acquire(runId, this.#owner, now);
    switch (lock.status) {
      case "missing":
        return refusal(runId, { message: `There is no run ${runId}.` });
      case "busy":
        return busyRefusal(runId);
      case "held":
        return refusal(runId, {
          message:
            `Run ${runId} is being advanced by ${lock.owner} (last heartbeat ${lock.heartbeatAt}); ` +
            "only one writer may advance a run at a time.",
          fix: `Try again when it is done, or after ${staleMinutes} minutes without a heartbeat.`,
        });
      case "acquired":
        return this.#heldRun(lock.writer, now, body);
    }
  }

  #heldRun(writer: Writer, now: Date, body: RunBody): Promise<Outcome<AdvancedRun>> {
    return this.#holding(writer, async () => {
      const run = await this.#read(writer.runId);
      return this.#targetRefusal(run) ?? body(run, writer, now);
    });
  }

  #targetRefusal(run: RunWithSteps): Outcome<AdvancedRun> | undefined {
    const system = this.#services.system;
    const { kind, mode, name } = run.target;
    const answer = kind === "action" ? system.action(`${mode}.${name}`) : system.workflow(mode, name);
    return answer.ok ? undefined : refusalOf(run.id, answer.problems);
  }

  async #holding(writer: Writer, body: () => Promise<Outcome<AdvancedRun>>): Promise<Outcome<AdvancedRun>> {
    try {
      return await this.#takingAnswers(writer, await body());
    } catch (error) {
      await this.#services.store.release(writer);
      return refusal(writer.runId, {
        message: this.#services.scrubber.redact(
          `Run ${writer.runId} stopped at an unexpected error: ${errorLine(error)}`,
        ),
        fix: `Fix the cause, then continue it with bay resume ${writer.runId}.`,
      });
    }
  }

  async #takingAnswers(writer: Writer, result: Outcome<AdvancedRun>): Promise<Outcome<AdvancedRun>> {
    let latest = result;
    while (!(await this.#services.store.releaseUnlessAnswered(writer))) {
      const taken = await this.#takeAnswers(writer);
      latest = result.ok && taken.ok ? taken : latest;
    }
    return latest;
  }

  async #takeAnswers(writer: Writer): Promise<Outcome<AdvancedRun>> {
    const now = this.#services.clock.now();
    for (const answer of await this.#services.store.recordedAnswers(writer.runId)) {
      await this.#takeAnswer(writer, answer, now.toISOString());
    }
    const run = await this.#read(writer.runId);
    return endedRefusal(run) ?? this.#continue(writer, { now, cause: "submit" }, {});
  }

  async #takeAnswer(writer: Writer, answer: RecordedAnswer, at: string): Promise<void> {
    const store = this.#services.store;
    const found = answerableSkill(await this.#read(writer.runId), answer.stepKey, new Set());
    if (!found.ok) {
      const detail = { stepKey: answer.stepKey, recordedAt: answer.at, reason: problemText(found.problems) };
      await store.forgetAnswer(writer, answer.stepKey, [{ at, runId: writer.runId, kind: answerDroppedKind, detail }]);
      return;
    }
    const detail = { ...found.value.detail, submission: answer.submission };
    await store.saveStepDetail(writer, { key: found.value.key, kind: "skill", detail, at }, []);
    await store.forgetAnswer(writer, answer.stepKey, []);
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
      detail: { cause: advance.cause, ...("by" in advance ? { by: advance.by } : {}) },
    };
    const update = { ...patch, state: { status: "running" as const }, at: advance.now.toISOString() };
    await this.#services.store.updateRun(writer, update, [resumed]);
    return this.#advance(writer, advance);
  }

  async #advance(writer: Writer, advance: Advance): Promise<Outcome<AdvancedRun>> {
    const run = await this.#read(writer.runId);
    const events = await this.#services.store.readEvents(run.id);
    const walk: Walk = {
      services: this.#services,
      writer,
      records: new Map(run.steps.map((step) => [step.key, step])),
      events,
      now: advance.now,
      rerunUnfinished: advance.cause === "rerun",
      stopReason: run.stopReason,
      extra: run.extra,
      until: untilIn(events),
      phase: "main",
    };
    const ending = await driveRun(walk, run);
    const update = { state: storedStateOf(ending.status), spent: ending.spent, at: advance.now.toISOString() };
    await this.#services.store.updateRun(writer, update, endingEvents(walk, ending.status));
    return succeededWith({ id: run.id, state: ending.status, spent: ending.spent });
  }
}
