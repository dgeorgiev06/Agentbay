import { resolve } from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Answer, errorLine, failed, granted, manifestOf, refused } from "../answers.ts";
import { Broker, type BrokerLimits } from "./broker.ts";
import type {
  ChildEnd,
  ChildProcesses,
  ChildRequest,
  Clock,
  FileInspector,
  FileSystem,
  Http,
  Processes,
  ThrowawayFolders,
} from "../ports.ts";
import type { EventSink, Json, ScriptRequest, ScriptRunner, Spend, StepOutcome } from "../contracts.ts";
import { mayRemoveFiles, writableFolders } from "./effect-rule.ts";
import { escapingLinks } from "./folder-links.ts";
import { isInsideOrEqual, shownPath, type Layout } from "../layout.ts";
import { type ChildMessage, childMessageOf, removalAllowedArgument, type ResourceRequest } from "./script-protocol.ts";
import type { SecretStore } from "../secrets.ts";

export type ScriptRunnerLimits = {
  readonly outputBytes: number;
};

export type ScriptRunnerOptions = {
  readonly layout: Layout;
  readonly files: FileSystem;
  readonly throwawayFolders: ThrowawayFolders;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly secrets: SecretStore;
  readonly events: EventSink;
  readonly clock: Clock;
  readonly childProcesses: ChildProcesses;
  readonly processes: Processes;
  readonly commandSearchPath: string;
  readonly limits?: Partial<ScriptRunnerLimits>;
  readonly brokerLimits?: Partial<BrokerLimits>;
};

type Spent = { items: number; usd: number; tokens: number };

type Final = Exclude<ChildMessage, { readonly type: "request" }>;

type RunState = {
  final: Final | undefined;
  malformed: boolean;
  readonly spent: Spent;
  readonly inFlight: Promise<void>[];
};

type Started = {
  readonly broker: Broker;
  readonly request: ScriptRequest;
  readonly state: RunState;
};

const defaultScriptRunnerLimits: ScriptRunnerLimits = { outputBytes: 4 * 1024 * 1024 };

const bayFolder = fileURLToPath(new URL("..", import.meta.url));

const hostFile = `${bayFolder}broker/script-host.ts`;

const preloadFile = `${bayFolder}broker/script-preload.ts`;

const filesTheHostReads: readonly string[] = [
  hostFile,
  preloadFile,
  `${bayFolder}broker/script-protocol.ts`,
  `${bayFolder}protocol-json.ts`,
  `${bayFolder}sdk.ts`,
];

function grants(access: "read" | "write", path: string): readonly string[] {
  if (filesTheHostReads.includes(path)) {
    return [`--allow-fs-${access}=${path}`];
  }
  return [`--allow-fs-${access}=${path}`, `--allow-fs-${access}=${path}/*`];
}

export function scriptCommand(scriptFile: string, request: ScriptRequest): readonly string[] {
  const granted = request.permissions.grants;
  const readable = [...new Set([...filesTheHostReads, granted.modeFolder, ...granted.readPaths])];
  return [
    "--permission",
    ...readable.flatMap((path) => grants("read", path)),
    ...writableFolders(request.permissions).flatMap((path) => grants("write", path)),
    "--disable-warning=ExperimentalWarning",
    `--import=${pathToFileURL(preloadFile).href}`,
    hostFile,
    scriptFile,
    ...(mayRemoveFiles(request.permissions) ? [removalAllowedArgument] : []),
  ];
}

function startMessage(request: ScriptRequest, now: Date): Readonly<Record<string, unknown>> {
  const caller = request.caller === undefined ? {} : { caller: request.caller };
  const skillInput = request.skillInput === undefined ? {} : { skillInput: request.skillInput };
  const fields = { input: request.input, settings: request.settings, now: now.toISOString() };
  return { type: "start", ...fields, ...caller, ...skillInput };
}

function seconds(milliseconds: number): string {
  return String(Number((milliseconds / 1000).toFixed(3)));
}

type DatabaseRequest = Extract<ResourceRequest, { resource: `db.${string}` }>;

function databaseAnswer(broker: Broker, request: DatabaseRequest) {
  switch (request.resource) {
    case "db.execute":
      return broker.execute(request.sql, request.parameters, request.partition);
    case "db.query":
      return broker.query(request.sql, request.parameters, request.partition);
    case "db.migrate":
      return broker.migrate(request.partition);
    case "db.agentQuery":
      return broker.agentQuery(request.sql, request.partition);
  }
}

function isDatabaseRequest(request: ResourceRequest): request is DatabaseRequest {
  return request.resource.startsWith("db.");
}

type FileRequest = Extract<ResourceRequest, { resource: `files.${string}` }>;

function fileAnswer(broker: Broker, request: FileRequest) {
  switch (request.resource) {
    case "files.read":
      return broker.readFile(request.path);
    case "files.write":
      return broker.writeFile(request.path, request.text);
    case "files.list":
      return broker.listFiles(request.path);
    case "files.makeFolder":
      return broker.makeFolder(request.path);
    case "files.link":
      return broker.link(request.path, request.target);
    case "files.remove":
      return broker.remove(request.path);
  }
}

function isFileRequest(request: ResourceRequest): request is FileRequest {
  return request.resource.startsWith("files.");
}

function brokerAnswer(broker: Broker, request: Exclude<ResourceRequest, { resource: "call" | "spend" }>) {
  if (isDatabaseRequest(request)) {
    return databaseAnswer(broker, request);
  }
  if (isFileRequest(request)) {
    return fileAnswer(broker, request);
  }
  switch (request.resource) {
    case "secrets.get":
      return broker.secret(request.name);
    case "http.request":
      return broker.request(request.request);
    case "events.emit":
      return broker.emit(request.kind, request.detail);
    case "commands.run":
      return broker.runCommand(request.request);
  }
}

async function calledAnswer(started: Started, request: { reference: string; input: Json }): Promise<Answer<Json>> {
  try {
    const outcome = await started.request.call(request.reference, request.input);
    return outcome.status === "done" ? granted(outcome.output) : failed(outcome.reason);
  } catch (error) {
    return started.broker.report(
      failed(`The call to ${request.reference} stopped at an unexpected error: ${errorLine(error)}`),
    );
  }
}

async function spentAnswer(started: Started, spending: Json): Promise<Answer<Json>> {
  const answer = await started.broker.spend(spending);
  if (!answer.ok) {
    return answer;
  }
  const spent = started.state.spent;
  spent.items += answer.value.items;
  spent.usd += answer.value.usd;
  spent.tokens += answer.value.tokens;
  return granted(null);
}

async function answerFor(started: Started, request: ResourceRequest): Promise<Answer<Json>> {
  if (request.resource === "call") {
    return calledAnswer(started, request);
  }
  if (request.resource === "spend") {
    return spentAnswer(started, request.spending);
  }
  return brokerAnswer(started.broker, request);
}

function endReason(end: ChildEnd, limits: { readonly milliseconds: number; readonly outputBytes: number }): string {
  switch (end.how) {
    case "timed-out":
      return `The script was stopped at its time limit of ${seconds(limits.milliseconds)} seconds.`;
    case "output-exceeded":
      return `The script printed more than ${String(limits.outputBytes)} bytes and was stopped.`;
    case "not-started":
      return `The script process could not start: ${end.errorOutput}`;
    case "signalled":
      return `The script ended by the signal ${end.signal} without returning a result. ${end.errorOutput}`;
    case "exited":
      return `The script ended without returning a result (exit code ${String(end.exitCode)}). ${end.errorOutput}`;
  }
}

function outcomeOf(
  state: RunState,
  end: ChildEnd,
  limits: { readonly milliseconds: number; readonly outputBytes: number },
) {
  if (state.malformed) {
    return { status: "failed" as const, reason: "The script sent a line that is not a valid message." };
  }
  const final = state.final;
  if (end.how !== "exited" || final === undefined) {
    return { status: "failed" as const, reason: endReason(end, limits).trim() };
  }
  switch (final.type) {
    case "done":
      return end.exitCode === 0
        ? { status: "done" as const, output: final.output }
        : { status: "failed" as const, reason: endReason(end, limits).trim() };
    case "failed":
      return { status: "failed" as const, reason: final.reason };
    case "crashed":
      return { status: "failed" as const, reason: `The script failed: ${final.reason}` };
  }
}

export function createScriptRunner(options: ScriptRunnerOptions): ScriptRunner {
  const limits = { ...defaultScriptRunnerLimits, ...options.limits };
  const zero = { items: 0, usd: 0, tokens: 0, minutes: 0 };
  const failure = (reason: string): StepOutcome => ({
    status: "failed",
    reason: options.secrets.redact(reason),
    spent: zero,
  });

  async function refusedBeforeStart(request: ScriptRequest, broker: Broker): Promise<string | undefined> {
    const permissions = request.permissions.grants;
    const scriptFile = resolve(permissions.modeFolder, request.script);
    if (!isInsideOrEqual(scriptFile, permissions.modeFolder)) {
      return `The script ${request.script} lies outside the folder of the mode ${permissions.mode}.`;
    }
    const folders = [permissions.modeFolder, ...permissions.readPaths, ...permissions.writePaths];
    const links = await escapingLinks(options.inspector, options.layout, folders);
    if (links.length === 0) {
      return undefined;
    }
    const described = links.map(
      (found) => `${shownPath(options.layout, found.link)} points to ${found.target ?? "nothing"}`,
    );
    const answer = await broker.report(
      refused({
        resource: "script",
        asked: `The script ${request.script} was to run with links that leave their folders (${described.join("; ")})`,
        declared: "a granted folder may hold only links that stay inside it",
        change: `Remove the links, or change resources.files in ${manifestOf(permissions)}.`,
      }),
    );
    return answer.ok ? undefined : answer.message;
  }

  async function runChild(started: Started, milliseconds: number): Promise<StepOutcome> {
    const { request, state, broker } = started;
    const startTime = options.clock.now();
    const startedAt = startTime.getTime();
    const childRequest: ChildRequest = {
      command: process.execPath,
      arguments: scriptCommand(resolve(request.permissions.grants.modeFolder, request.script), request),
      directory: request.permissions.grants.modeFolder,
      environment: {},
      timeoutMilliseconds: milliseconds,
      maximumOutputBytes: limits.outputBytes,
    };
    const child = options.childProcesses.start(childRequest, (line) => {
      const message = childMessageOf(line);
      if (message === undefined || (message.type !== "request" && state.final !== undefined)) {
        state.malformed = true;
        child.kill();
      } else if (message.type === "request") {
        const answered = answerFor(started, message.request).then((answer) => {
          child.send(JSON.stringify({ type: "answer", id: message.id, answer }));
        });
        state.inFlight.push(answered);
      } else {
        state.final = message;
      }
    });
    child.send(JSON.stringify(startMessage(request, startTime)));
    const end = await child.ended;
    broker.close();
    await Promise.all(state.inFlight);
    const minutes = (options.clock.now().getTime() - startedAt) / 60_000;
    const outcome = outcomeOf(state, end, { milliseconds, outputBytes: limits.outputBytes });
    const spent: Spend = { ...state.spent, minutes };
    if (outcome.status === "done") {
      return { status: "done", output: options.secrets.redactJson(outcome.output), spent };
    }
    return { status: "failed", reason: options.secrets.redact(outcome.reason), spent };
  }

  async function run(request: ScriptRequest): Promise<StepOutcome> {
    const milliseconds = request.timeLimitMilliseconds;
    if (milliseconds <= 0) {
      return failure("The step has no time left, so the script was not started.");
    }
    const broker = new Broker({
      layout: options.layout,
      permissions: request.permissions,
      place: request.place,
      files: options.files,
      throwawayFolders: options.throwawayFolders,
      inspector: options.inspector,
      http: options.http,
      secrets: options.secrets,
      events: options.events,
      clock: options.clock,
      childProcesses: options.childProcesses,
      processes: options.processes,
      commandSearchPath: options.commandSearchPath,
      limits: { databaseMilliseconds: milliseconds, commandMilliseconds: milliseconds, ...options.brokerLimits },
    });
    try {
      const refusal = await refusedBeforeStart(request, broker);
      if (refusal !== undefined) {
        return failure(refusal);
      }
      const state: RunState = {
        final: undefined,
        malformed: false,
        spent: { items: 0, usd: 0, tokens: 0 },
        inFlight: [],
      };
      return await runChild({ broker, request, state }, milliseconds);
    } finally {
      broker.close();
    }
  }

  return { run };
}
