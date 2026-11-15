import { errorLine, type Answer } from "./answers.ts";
import type { Broker } from "./broker.ts";
import type { Json } from "./contracts.ts";
import { byteSize, fieldOf, numberField, textField } from "./json.ts";
import type { Kernel } from "./kernel.ts";
import type { StepRecord } from "./run-store.ts";
import type { EngineResult, RunView } from "./run-state.ts";
import { isToolName, skillToolsOf, type SkillTools, type ToolName } from "./skill-tools.ts";
import { isRecord } from "./spec.ts";
import { resolveCall, resolveOwnAction, type ActionTarget } from "./targets.ts";
import { checkTaskToken, issueTaskToken } from "./task-tokens.ts";
import { skillStepAt, type SkillStepAt } from "./waiting.ts";

export type ToolResult = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly refusal: string };

type ToolCall = {
  readonly kernel: Kernel;
  readonly step: SkillStepAt;
  readonly tools: SkillTools;
  readonly input: Json;
};

type ToolHandler = (call: ToolCall) => Promise<ToolResult>;

export const toolResultBytes = 256 * 1024;

export const askedByKind = "run.asked-by";

function refused(refusal: string): ToolResult {
  return { ok: false, refusal };
}

function answered<T extends Json>(answer: Answer<T>, shape: (value: T) => Json): ToolResult {
  return answer.ok ? { ok: true, value: shape(answer.value) } : refused(answer.message);
}

async function withBroker(call: ToolCall, use: (broker: Broker) => Promise<ToolResult>): Promise<ToolResult> {
  const broker = call.kernel.brokerFor(call.step.task.place, call.step.task.permissions);
  try {
    return await use(broker);
  } finally {
    broker.close();
  }
}

function textInput(call: ToolCall, name: string): string | ToolResult {
  return textField(call.input, name) ?? refused(`The call needs ${name} as text.`);
}

async function databaseQuery(call: ToolCall): Promise<ToolResult> {
  const sql = textInput(call, "sql");
  if (typeof sql !== "string") {
    return sql;
  }
  return withBroker(call, async (broker) => {
    const answer = await broker.agentQuery(sql);
    return answer.ok
      ? { ok: true, value: { columns: answer.value.columns, rows: answer.value.rows } }
      : refused(answer.message);
  });
}

async function filesRead(call: ToolCall): Promise<ToolResult> {
  const path = textInput(call, "path");
  if (typeof path !== "string") {
    return path;
  }
  return withBroker(call, async (broker) => answered(await broker.readFile(path), (text) => ({ path, text })));
}

async function filesList(call: ToolCall): Promise<ToolResult> {
  const path = textInput(call, "path");
  if (typeof path !== "string") {
    return path;
  }
  return withBroker(call, async (broker) =>
    answered(await broker.listFiles(path), (names) => ({ path, names: [...names] })),
  );
}

async function filesWrite(call: ToolCall): Promise<ToolResult> {
  const path = textInput(call, "path");
  const text = textInput(call, "text");
  if (typeof path !== "string") {
    return path;
  }
  if (typeof text !== "string") {
    return text;
  }
  return withBroker(call, async (broker) => answered(await broker.writeFile(path, text), () => ({ written: path })));
}

function callTarget(call: ToolCall, action: string): ActionTarget | string {
  if (!call.tools.actions.includes(action)) {
    const listed = call.tools.actions.join(", ");
    return `The skill does not list ${action} under Tools; it may call: ${listed === "" ? "nothing" : listed}.`;
  }
  const mode = call.step.target.mode;
  if (action.includes(".")) {
    return resolveCall(call.kernel.system, mode, action);
  }
  return resolveOwnAction(call.kernel.system, mode.manifest.name, action);
}

async function recordAskedBy(call: ToolCall, result: EngineResult): Promise<void> {
  if (!result.ok) {
    return;
  }
  await call.kernel.store.append({
    at: call.kernel.ports.clock.now().toISOString(),
    runId: result.run.id,
    kind: askedByKind,
    detail: { runId: call.step.task.place.runId, stepKey: call.step.waitingKey },
  });
}

function calledResult(result: EngineResult, action: string): ToolResult {
  if (!result.ok) {
    return refused(result.problems.map((problem) => problem.message).join(" "));
  }
  const state = result.run.state;
  switch (state.status) {
    case "done":
      return { ok: true, value: { output: state.output, run: result.run.id } };
    case "failed":
    case "undone":
      return refused(`The action ${action} failed: ${state.reason}`);
    case "waiting":
      return refused(
        `The action ${action} stopped to wait for ${state.waiting.reason} (run ${result.run.id}); ` +
          "an action called from a skill must finish without waiting.",
      );
  }
}

async function callAction(call: ToolCall): Promise<ToolResult> {
  const action = textInput(call, "action");
  if (typeof action !== "string") {
    return action;
  }
  const target = callTarget(call, action);
  if (typeof target === "string") {
    return refused(target);
  }
  const effects = target.action.effects;
  if (effects.some((effect) => effect !== "read")) {
    return refused(
      `The action ${action} has the effects ${effects.join(", ")}; a skill may call only actions whose effects ` +
        "are read only.",
    );
  }
  const caller = action.includes(".") ? { caller: call.step.target.mode.manifest.name } : {};
  const result = await call.kernel.engine.startForSkill({
    runId: call.step.task.place.runId,
    stepKey: call.step.waitingKey,
    reference: `${target.mode.manifest.name}.${target.name}`,
    input: fieldOf(call.input, "input") ?? {},
    ...caller,
  });
  await recordAskedBy(call, result);
  return calledResult(result, action);
}

function spentAmount(input: Json, name: string): number | string {
  const field = fieldOf(input, name);
  if (field === undefined) {
    return 0;
  }
  const amount = numberField(input, name);
  if (amount === undefined || !Number.isFinite(amount) || amount < 0) {
    return `${name} must be a number of at least 0.`;
  }
  return amount;
}

function settledSubmission(run: RunView, record: StepRecord | undefined): Json {
  const waiting = run.state.status === "waiting" ? run.state.waiting : undefined;
  const next =
    waiting?.reason === "skill"
      ? { next: `The run waits for another skill step; bay runs ${run.id} --new-token gives its task.` }
      : {};
  const reason = record?.status === "failed" ? { reason: record.reason } : {};
  const summary = {
    id: run.id,
    status: run.state.status,
    ...(waiting === undefined ? {} : { waitingFor: waiting.reason }),
  };
  return { accepted: record?.status === "finished", run: summary, ...reason, ...next };
}

async function submittedResult(call: ToolCall, result: EngineResult): Promise<ToolResult> {
  if (!result.ok) {
    return { ok: true, value: { accepted: false, problems: result.problems.map((problem) => problem.message) } };
  }
  const run = result.run;
  const record = run.steps.find((step) => step.key === call.step.task.place.stepKey);
  if (run.state.status === "waiting" && run.state.waiting.reason === "skill" && record?.status === "started") {
    const task = run.state.waiting.task;
    const place = { runId: run.id, stepKey: run.state.waiting.stepKey, round: task.round };
    const token = await issueTaskToken(call.kernel.store, place, call.kernel.ports.clock.now());
    return {
      ok: true,
      value: { accepted: false, round: task.round, feedback: [...task.feedback], stepKey: place.stepKey, token },
    };
  }
  return { ok: true, value: settledSubmission(run, record) };
}

async function submit(call: ToolCall): Promise<ToolResult> {
  const output = fieldOf(call.input, "output");
  if (output === undefined) {
    return refused("The call needs output: your result, matching the task's outputSchema.");
  }
  const tokens = spentAmount(call.input, "tokens");
  const usd = spentAmount(call.input, "usd");
  if (typeof tokens === "string" || typeof usd === "string") {
    return refused([tokens, usd].filter((entry) => typeof entry === "string").join(" "));
  }
  const spent = { items: 0, usd, tokens, minutes: 0 };
  const place = call.step.task.place;
  const result = await call.kernel.engine.submit(place.runId, call.step.waitingKey, { output, spent });
  return submittedResult(call, result);
}

const handlers: { readonly [Name in ToolName]: ToolHandler } = {
  db_query: databaseQuery,
  files_read: filesRead,
  files_list: filesList,
  files_write: filesWrite,
  call_action: callAction,
  submit,
};

async function stepOfToken(kernel: Kernel, token: string): Promise<SkillStepAt | string> {
  const checked = await checkTaskToken({ tokens: kernel.store, runs: kernel.store }, token);
  if (!checked.ok) {
    return checked.reason;
  }
  const run = await kernel.store.readRun(checked.place.runId);
  if (run === undefined) {
    return `There is no run ${checked.place.runId}.`;
  }
  return skillStepAt(kernel, run, checked.place.stepKey);
}

function capped(kernel: Kernel, result: ToolResult): ToolResult {
  const scrubbed: ToolResult = result.ok
    ? { ok: true, value: kernel.secrets.redactJson(result.value) }
    : refused(kernel.secrets.redact(result.refusal));
  const size = scrubbed.ok ? byteSize(scrubbed.value) : 0;
  if (size <= toolResultBytes) {
    return scrubbed;
  }
  return refused(
    `The result is ${String(size)} bytes, over the cap of ${String(toolResultBytes)} bytes for one tool result; ` +
      "ask for less, such as a narrower query or a smaller file.",
  );
}

async function recordCall(kernel: Kernel, step: SkillStepAt, entry: { name: ToolName; ok: boolean }): Promise<void> {
  await kernel.store.append({
    at: kernel.ports.clock.now().toISOString(),
    runId: step.task.place.runId,
    kind: "tool.called",
    detail: { tool: entry.name, stepKey: step.waitingKey, ok: entry.ok },
  });
}

async function callsThisRound(kernel: Kernel, step: SkillStepAt): Promise<number> {
  const events = await kernel.store.readEvents(step.task.place.runId);
  return events.filter(
    (event) => event.kind === "tool.called" && textField(event.detail, "stepKey") === step.waitingKey,
  ).length;
}

async function overLimit(kernel: Kernel, name: ToolName, step: SkillStepAt): Promise<ToolResult | undefined> {
  if (name === "submit" || (await callsThisRound(kernel, step)) < kernel.limits.toolCallsPerRound) {
    return undefined;
  }
  return refused(
    `This round of step ${step.waitingKey} has used its ${String(kernel.limits.toolCallsPerRound)} tool calls. ` +
      "Submit your output now with submit; only submit still works in this round.",
  );
}

async function performed(
  kernel: Kernel,
  request: { name: ToolName; input: Json; step: SkillStepAt },
): Promise<ToolResult> {
  const { name, input, step } = request;
  const limited = await overLimit(kernel, name, step);
  if (limited !== undefined) {
    return limited;
  }
  const tools = await skillToolsOf(kernel.ports.files, step.skillFile);
  if (!tools.kernelTools.includes(name)) {
    const named = tools.kernelTools.join(", ");
    return refused(
      `The skill ${step.task.skill} of mode ${step.task.place.mode} does not name the tool ${name} in its Tools ` +
        `section; it may use: ${named}.`,
    );
  }
  return handlers[name]({ kernel, step, tools, input });
}

export async function callKernelTool(kernel: Kernel, name: string, input: Json): Promise<ToolResult> {
  try {
    return await checkedToolCall(kernel, name, input);
  } catch (error) {
    return refused(kernel.secrets.redact(`The tool ${name} stopped at an unexpected error: ${errorLine(error)}`));
  }
}

async function checkedToolCall(kernel: Kernel, name: string, input: Json): Promise<ToolResult> {
  if (!isToolName(name)) {
    return refused(
      `There is no kernel tool ${name}; the tools are db_query, files_read, files_list, ` +
        "files_write, call_action and submit.",
    );
  }
  const token = isRecord(input) ? textField(input, "token") : undefined;
  if (token === undefined) {
    return refused("Every tool call needs token: the token of your task, exactly as the task gave it.");
  }
  const step = await stepOfToken(kernel, token);
  if (typeof step === "string") {
    return refused(step);
  }
  const result = capped(kernel, await performed(kernel, { name, input, step }));
  await recordCall(kernel, step, { name, ok: result.ok });
  return result;
}
