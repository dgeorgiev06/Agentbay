import { errorLine, type Answer } from "./answers.ts";
import type { Broker } from "./broker.ts";
import type { Json } from "./contracts.ts";
import { byteSize, fieldOf, numberField, textField, isRecord } from "./json.ts";
import type { Kernel } from "./kernel.ts";
import { actionsListing, loadSystemReport, type ListingQuestion, type System } from "./manifests/manifests.ts";
import type { Run, Task } from "./runs/runs.ts";
import { failedWith, unplacedProblem, type Outcome, type Problem } from "./outcome.ts";
import { isToolName, skillToolsOf, type SkillTools, type ToolName } from "./skill-tools.ts";
import { actionsToolName } from "./tool-definitions.ts";

type ToolCall = {
  readonly kernel: Kernel;
  readonly token: string;
  readonly task: Task;
  readonly tools: SkillTools;
  readonly input: Json;
};

type ToolHandler = (call: ToolCall) => Promise<Outcome<Json>>;

const toolResultBytes = 256 * 1024;

function refused(refusal: string): Outcome<never> {
  return failedWith([unplacedProblem(refusal)]);
}

function answered<T extends Json>(answer: Answer<T>, shape: (value: T) => Json): Outcome<Json> {
  return answer.ok ? { ok: true, value: shape(answer.value) } : refused(answer.message);
}

async function withBroker(call: ToolCall, use: (broker: Broker) => Promise<Outcome<Json>>): Promise<Outcome<Json>> {
  const broker = call.kernel.brokerFor(call.task.place, call.task.permissions);
  try {
    return await use(broker);
  } finally {
    broker.close();
  }
}

function textInput(call: ToolCall, name: string): string | Outcome<Json> {
  return textField(call.input, name) ?? refused(`The call needs ${name} as text.`);
}

async function databaseQuery(call: ToolCall): Promise<Outcome<Json>> {
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

async function filesRead(call: ToolCall): Promise<Outcome<Json>> {
  const path = textInput(call, "path");
  if (typeof path !== "string") {
    return path;
  }
  return withBroker(call, async (broker) => answered(await broker.readFile(path), (text) => ({ path, text })));
}

async function filesList(call: ToolCall): Promise<Outcome<Json>> {
  const path = textInput(call, "path");
  if (typeof path !== "string") {
    return path;
  }
  return withBroker(call, async (broker) =>
    answered(await broker.listFiles(path), (names) => ({ path, names: [...names] })),
  );
}

async function filesWrite(call: ToolCall): Promise<Outcome<Json>> {
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

function unlisted(call: ToolCall, action: string): Outcome<Json> | undefined {
  if (call.tools.actions.includes(action)) {
    return undefined;
  }
  const listed = call.tools.actions.join(", ");
  return refused(`The skill does not list ${action} under Tools; it may call: ${listed === "" ? "nothing" : listed}.`);
}

async function callAction(call: ToolCall): Promise<Outcome<Json>> {
  const action = textInput(call, "action");
  if (typeof action !== "string") {
    return action;
  }
  const refusal = unlisted(call, action);
  if (refusal !== undefined) {
    return refusal;
  }
  const called = await call.kernel.runs.callAction(call.token, action, fieldOf(call.input, "input") ?? {});
  return called.ok ? { ok: true, value: { output: called.value.output, run: called.value.runId } } : called;
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

function settledSubmission(run: Run, step: Run["steps"][number] | undefined): Json {
  const waiting = run.state.status === "waiting" ? run.state.waiting : undefined;
  const next =
    waiting?.reason === "skill"
      ? { next: `The run waits for another skill step; bay runs ${run.id} --new-token gives its task.` }
      : {};
  const reason = step?.status === "failed" ? { reason: step.reason } : {};
  const summary = {
    id: run.id,
    status: run.state.status,
    ...(waiting === undefined ? {} : { waitingFor: waiting.reason }),
  };
  return { accepted: step?.status === "done", run: summary, ...reason, ...next };
}

function submittedResult(call: ToolCall, result: Outcome<Run>): Json {
  if (!result.ok) {
    return { accepted: false, problems: result.problems.map((problem) => problem.message) };
  }
  const run = result.value;
  const waiting = run.state.status === "waiting" ? run.state.waiting : undefined;
  if (waiting?.reason === "skill" && waiting.task.token !== undefined) {
    const { round, feedback, token } = waiting.task;
    return { accepted: false, round, feedback: [...feedback], stepKey: waiting.stepKey, token };
  }
  return settledSubmission(
    run,
    run.steps.find((step) => step.key === call.task.place.stepKey),
  );
}

async function submit(call: ToolCall): Promise<Outcome<Json>> {
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
  const result = await call.kernel.runs.submit(call.token, { output, spent });
  return { ok: true, value: submittedResult(call, result) };
}

const handlers: { readonly [Name in ToolName]: ToolHandler } = {
  db_query: databaseQuery,
  files_read: filesRead,
  files_list: filesList,
  files_write: filesWrite,
  call_action: callAction,
  submit,
};

const listingFields: readonly string[] = ["mode", "find"];

function listingQuestion(input: Json): ListingQuestion | undefined {
  if (!isRecord(input) || Object.keys(input).some((key) => !listingFields.includes(key))) {
    return undefined;
  }
  const mode = fieldOf(input, "mode");
  const find = fieldOf(input, "find");
  if ((mode !== undefined && typeof mode !== "string") || (find !== undefined && typeof find !== "string")) {
    return undefined;
  }
  return { ...(mode === undefined ? {} : { mode }), ...(find === undefined ? {} : { find }) };
}

type SystemLoader = () => Promise<Outcome<System>>;

async function listActions(loadSystem: SystemLoader, input: Json): Promise<Outcome<Json>> {
  const question = listingQuestion(input);
  if (question === undefined) {
    return refused("The tool actions takes only mode and find, both optional text; it needs no token.");
  }
  const system = await loadSystem();
  if (!system.ok) {
    return system;
  }
  const listing = actionsListing(system.value, question);
  return listing.ok ? { ok: true, value: { ...listing.value } } : listing;
}

function systemLoaderOf(kernel: Kernel): SystemLoader {
  return async () => (await loadSystemReport(kernel.ports.files, kernel.layout)).outcome;
}

function redactedProblem(kernel: Kernel, problem: Problem): Problem {
  const fix = problem.fix === undefined ? {} : { fix: kernel.secrets.redact(problem.fix) };
  return { ...problem, message: kernel.secrets.redact(problem.message), ...fix };
}

function capped(kernel: Kernel, result: Outcome<Json>): Outcome<Json> {
  const scrubbed: Outcome<Json> = result.ok
    ? { ok: true, value: kernel.secrets.redactJson(result.value) }
    : failedWith(result.problems.map((problem) => redactedProblem(kernel, problem)));
  const size = scrubbed.ok ? byteSize(scrubbed.value) : 0;
  if (size <= toolResultBytes) {
    return scrubbed;
  }
  return refused(
    `The result is ${String(size)} bytes, over the cap of ${String(toolResultBytes)} bytes for one tool result; ` +
      "ask for less, such as a narrower query or a smaller file.",
  );
}

async function performed(
  kernel: Kernel,
  request: { name: ToolName; token: string; input: Json },
): Promise<Outcome<Json>> {
  const { name, token, input } = request;
  const task = await kernel.runs.task(token, name);
  if (!task.ok) {
    return task;
  }
  const tools = await skillToolsOf(kernel.ports.files, task.value.files.skill);
  if (!tools.kernelTools.includes(name)) {
    const named = tools.kernelTools.join(", ");
    return refused(
      `The skill ${task.value.skill} of mode ${task.value.place.mode} does not name the tool ${name} in its Tools ` +
        `section; it may use: ${named}.`,
    );
  }
  return handlers[name]({ kernel, token, task: task.value, tools, input });
}

export async function callKernelTool(kernel: Kernel, name: string, input: Json): Promise<Outcome<Json>> {
  try {
    return await checkedToolCall(kernel, name, input);
  } catch (error) {
    return refused(kernel.secrets.redact(`The tool ${name} stopped at an unexpected error: ${errorLine(error)}`));
  }
}

async function checkedToolCall(kernel: Kernel, name: string, input: Json): Promise<Outcome<Json>> {
  if (name === actionsToolName) {
    return capped(kernel, await listActions(systemLoaderOf(kernel), input));
  }
  if (!isToolName(name)) {
    return refused(
      `There is no kernel tool ${name}; the tools are actions, db_query, files_read, files_list, ` +
        "files_write, call_action and submit.",
    );
  }
  const token = isRecord(input) ? textField(input, "token") : undefined;
  if (token === undefined) {
    return refused("Every tool call needs token: the token of your task, exactly as the task gave it.");
  }
  return capped(kernel, await performed(kernel, { name, token, input }));
}
